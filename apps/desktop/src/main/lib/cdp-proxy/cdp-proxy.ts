import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import path from "node:path";
import { BrowserWindow, webContents } from "electron";
import { WebSocket, WebSocketServer } from "ws";
import { browserManager } from "../browser/browser-manager";

const ALLOWED_TARGET_TYPES = new Set(["page", "webview"]);

interface CDPTarget {
	id?: string;
	type: string;
	url?: string;
	webSocketDebuggerUrl?: string;
	devtoolsFrontendUrl?: string;
	[key: string]: unknown;
}

function getAppOrigins(): Set<string> {
	const origins = new Set<string>();
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) continue;
		try {
			origins.add(new URL(win.webContents.getURL()).origin);
		} catch {}
	}
	return origins;
}

function pathsMatch(a: string, b: string): boolean {
	const na = path.resolve(a).toLowerCase();
	const nb = path.resolve(b).toLowerCase();
	return na === nb || nb.startsWith(`${na}${path.sep}`);
}

function isTargetOwnedByCwd(targetId: string, cwd: string): boolean {
	const wc = webContents.fromDevToolsTargetId(targetId);
	if (!wc) return false;
	const targetCwd = browserManager.getCwdForWebContentsId(wc.id);
	if (!targetCwd) return false;
	return pathsMatch(cwd, targetCwd);
}

function isAllowedTarget(target: CDPTarget, cwd: string | null): boolean {
	if (!ALLOWED_TARGET_TYPES.has(target.type)) return false;
	const appOrigins = getAppOrigins();
	if (target.url) {
		try {
			if (appOrigins.has(new URL(target.url).origin)) return false;
		} catch {}
	}
	if (cwd && target.id) {
		return isTargetOwnedByCwd(target.id, cwd);
	}
	return true;
}

function filterTargets(
	targets: CDPTarget[],
	proxyHost: string,
	cwd: string | null,
): CDPTarget[] {
	return targets
		.filter((t) => isAllowedTarget(t, cwd))
		.map((t) => ({
			...t,
			webSocketDebuggerUrl: t.webSocketDebuggerUrl?.replace(
				/(127\.0\.0\.1|localhost):\d+/,
				proxyHost,
			),
			devtoolsFrontendUrl: t.devtoolsFrontendUrl?.replace(
				/(127\.0\.0\.1|localhost):\d+/,
				proxyHost,
			),
		}));
}

interface TargetInfo {
	targetId?: string;
	type?: string;
	url?: string;
}

function isTargetInfoAllowed(info: TargetInfo, cwd: string): boolean {
	if (!ALLOWED_TARGET_TYPES.has(info.type ?? "")) return false;
	const appOrigins = getAppOrigins();
	if (info.url) {
		try {
			if (appOrigins.has(new URL(info.url).origin)) return false;
		} catch {}
	}
	if (info.targetId) {
		return isTargetOwnedByCwd(info.targetId, cwd);
	}
	return true;
}

interface ProxyFilterState {
	blockedSessionIds: Set<string>;
	internalRequestIds: Set<number>;
	clientRequestedTargets: Set<string>;
	nextInternalId: number;
}

function createFilterState(): ProxyFilterState {
	return {
		blockedSessionIds: new Set(),
		internalRequestIds: new Set(),
		clientRequestedTargets: new Set(),
		nextInternalId: -1000,
	};
}

function filterUpstreamMessage(
	raw: string,
	cwd: string,
	state: ProxyFilterState,
	upstreamWs: WebSocket,
	clientWs: WebSocket,
): void {
	let msg: {
		id?: number;
		method?: string;
		sessionId?: string;
		result?: { targetInfos?: Array<TargetInfo> };
		params?: {
			sessionId?: string;
			targetInfo?: TargetInfo;
			waitingForDebugger?: boolean;
		};
	};
	try {
		msg = JSON.parse(raw);
	} catch {
		clientWs.send(raw);
		return;
	}

	// Drop responses to our internal commands
	if (msg.id != null && state.internalRequestIds.has(msg.id)) {
		state.internalRequestIds.delete(msg.id);
		return;
	}

	// Drop all messages on blocked sessions
	if (msg.sessionId && state.blockedSessionIds.has(msg.sessionId)) {
		return;
	}

	// Filter target discovery
	if (
		msg.method === "Target.targetCreated" ||
		msg.method === "Target.targetInfoChanged"
	) {
		const info = msg.params?.targetInfo;
		if (info && !isTargetInfoAllowed(info, cwd)) {
			return;
		}
	}

	// Filter auto-attach: hide unwanted targets but release them upstream
	if (msg.method === "Target.attachedToTarget") {
		const info = msg.params?.targetInfo;
		const sessionId = msg.params?.sessionId;

		if (info && sessionId) {
			const explicitlyRequested =
				info.targetId && state.clientRequestedTargets.has(info.targetId);

			if (!explicitlyRequested && !isTargetInfoAllowed(info, cwd)) {
				state.blockedSessionIds.add(sessionId);

				if (
					msg.params?.waitingForDebugger &&
					upstreamWs.readyState === WebSocket.OPEN
				) {
					const releaseId = state.nextInternalId--;
					state.internalRequestIds.add(releaseId);
					upstreamWs.send(
						JSON.stringify({
							id: releaseId,
							method: "Runtime.runIfWaitingForDebugger",
							sessionId,
						}),
					);
				}
				return;
			}
		}
	}

	// Filter Target.getTargets responses
	if (msg.result?.targetInfos) {
		msg.result.targetInfos = msg.result.targetInfos.filter((t) =>
			isTargetInfoAllowed(t, cwd),
		);
		clientWs.send(JSON.stringify(msg));
		return;
	}

	// Forward everything else unchanged
	clientWs.send(raw);
}

const CDP_PROXY_PORT = 9334;
const CWD_PREFIX_RE = /^\/cwd\/([A-Za-z0-9_-]+)(\/devtools\/.+)/;

function parseCwdPrefix(url: string): {
	cwd: string;
	rest: string;
} | null {
	const match = url.match(CWD_PREFIX_RE);
	if (!match) return null;
	try {
		const cwd = Buffer.from(match[1], "base64url").toString("utf-8");
		return { cwd, rest: match[2] };
	} catch {
		return null;
	}
}

export function startCDPProxy(upstreamPort: number): Promise<number> {
	const upstreamBase = `http://127.0.0.1:${upstreamPort}`;
	const wss = new WebSocketServer({ noServer: true });

	const server = createServer(
		async (req: IncomingMessage, res: ServerResponse) => {
			const url = req.url ?? "/";

			if (url === "/json" || url === "/json/list" || url === "/json/") {
				try {
					const resp = await fetch(`${upstreamBase}${url}`);
					const targets: CDPTarget[] = await resp.json();
					const proxyHost = `127.0.0.1:${(server.address() as { port: number }).port}`;
					const filtered = filterTargets(targets, proxyHost, null);
					res.writeHead(200, {
						"Content-Type": "application/json",
					});
					res.end(JSON.stringify(filtered));
				} catch (err) {
					res.writeHead(502);
					res.end(String(err));
				}
				return;
			}

			if (url === "/json/version") {
				try {
					const resp = await fetch(`${upstreamBase}/json/version`);
					const version = (await resp.json()) as {
						webSocketDebuggerUrl?: string;
					};
					const proxyHost = `127.0.0.1:${(server.address() as { port: number }).port}`;
					if (version.webSocketDebuggerUrl) {
						version.webSocketDebuggerUrl = version.webSocketDebuggerUrl.replace(
							/(127\.0\.0\.1|localhost):\d+/,
							proxyHost,
						);
					}
					res.writeHead(200, {
						"Content-Type": "application/json",
					});
					res.end(JSON.stringify(version));
				} catch (err) {
					res.writeHead(502);
					res.end(String(err));
				}
				return;
			}

			try {
				const resp = await fetch(`${upstreamBase}${url}`);
				res.writeHead(resp.status);
				res.end(Buffer.from(await resp.arrayBuffer()));
			} catch (err) {
				res.writeHead(502);
				res.end(String(err));
			}
		},
	);

	server.on("upgrade", (req, socket, head) => {
		const rawUrl = req.url ?? "/";

		const parsed = parseCwdPrefix(rawUrl);
		if (!parsed) {
			socket.write(
				"HTTP/1.1 400 Bad Request\r\n\r\nMissing /cwd/<base64url> prefix in WebSocket path\r\n",
			);
			socket.destroy();
			return;
		}

		const { cwd, rest: upstreamPath } = parsed;
		const isBrowserEndpoint = upstreamPath.startsWith("/devtools/browser");
		console.log(`[cdp-proxy] WS connect cwd=${cwd}`);

		wss.handleUpgrade(req, socket, head, (clientWs) => {
			const upstreamWs = new WebSocket(
				`ws://127.0.0.1:${upstreamPort}${upstreamPath}`,
			);

			const filterState = createFilterState();
			const pendingMessages: {
				data: unknown;
				isBinary: boolean;
			}[] = [];

			clientWs.on("message", (data, isBinary) => {
				// Track explicit Target.attachToTarget from client
				if (isBrowserEndpoint) {
					try {
						const str =
							typeof data === "string"
								? data
								: Buffer.isBuffer(data)
									? data.toString("utf-8")
									: Buffer.from(data as ArrayBuffer).toString("utf-8");
						const msg = JSON.parse(str) as {
							method?: string;
							params?: { targetId?: string };
						};
						if (
							msg.method === "Target.attachToTarget" &&
							msg.params?.targetId
						) {
							filterState.clientRequestedTargets.add(msg.params.targetId);
						}
					} catch {}
				}
				if (upstreamWs.readyState === WebSocket.OPEN) {
					upstreamWs.send(data, { binary: isBinary });
				} else {
					pendingMessages.push({ data, isBinary });
				}
			});

			upstreamWs.on("open", () => {
				for (const msg of pendingMessages) {
					upstreamWs.send(msg.data as Buffer, {
						binary: msg.isBinary,
					});
				}
				pendingMessages.length = 0;
			});

			upstreamWs.on("message", (data, isBinary) => {
				if (!isBrowserEndpoint) {
					clientWs.send(data, { binary: isBinary });
					return;
				}
				const raw =
					typeof data === "string"
						? data
						: Buffer.isBuffer(data)
							? data.toString("utf-8")
							: Buffer.from(data as ArrayBuffer).toString("utf-8");
				filterUpstreamMessage(raw, cwd, filterState, upstreamWs, clientWs);
			});

			clientWs.on("close", () => upstreamWs.close());
			upstreamWs.on("close", () => clientWs.close());
			clientWs.on("error", () => upstreamWs.close());
			upstreamWs.on("error", () => clientWs.close());
		});
	});

	return new Promise((resolve) => {
		server.listen(CDP_PROXY_PORT, "127.0.0.1", () => {
			const addr = server.address() as { port: number };
			console.log(
				`[cdp-proxy] Filtering proxy on port ${addr.port} → upstream ${upstreamPort}`,
			);
			resolve(addr.port);
		});
	});
}
