import { type ChildProcess, spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { SUPERSET_HOME_DIR } from "../app-environment";

export type VscodeVariant = "vscode" | "vscode-insiders";

const STARTUP_TIMEOUT_MS = 60_000;
const SERVE_WEB_PORT = 3740;
const URL_PATTERN = /Web UI available at (https?:\/\/\S+)/;
// Pinned to 1.114.0 — versions after this break the WebSocket protocol
// handshake for serve-web (tested: 1.119.0 hangs on management channel).
// Bump only after verifying the new version's serve-web works locally.
const PINNED_CLI_VERSION = "1.114.0";
const PINNED_COMMIT_ID = "e7fb5e96c0730b9deb70b33781f98e2f35975036";

const VSCODE_APP_PATHS: Record<VscodeVariant, string[]> = {
	vscode: [
		"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
		"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel",
	],
	"vscode-insiders": [
		"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
		"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-tunnel",
	],
};

const STANDALONE_DOWNLOAD_URLS: Record<string, string> = {
	"darwin-arm64": `https://update.code.visualstudio.com/${PINNED_CLI_VERSION}/cli-darwin-arm64/stable`,
	"darwin-x64": `https://update.code.visualstudio.com/${PINNED_CLI_VERSION}/cli-darwin-x64/stable`,
	"linux-x64": `https://update.code.visualstudio.com/${PINNED_CLI_VERSION}/cli-linux-x64/stable`,
	"linux-arm64": `https://update.code.visualstudio.com/${PINNED_CLI_VERSION}/cli-linux-arm64/stable`,
};

interface ServeWebInstance {
	process: ChildProcess;
	baseUrl: string;
}

function getStandaloneBinDir(): string {
	return join(SUPERSET_HOME_DIR, "bin");
}

function getStandaloneBinPath(): string {
	return join(getStandaloneBinDir(), "code");
}

function resolveCodeBinary(variant: VscodeVariant): string | null {
	const appPaths = VSCODE_APP_PATHS[variant];
	for (const p of appPaths) {
		if (existsSync(p)) return p;
	}
	const standalone = getStandaloneBinPath();
	if (existsSync(standalone)) return standalone;
	return null;
}

async function downloadStandaloneCLI(): Promise<string> {
	const key = `${process.platform}-${process.arch}`;
	const downloadUrl = STANDALONE_DOWNLOAD_URLS[key];
	if (!downloadUrl) {
		throw new Error(`No standalone VS Code CLI available for ${key}`);
	}

	const binDir = getStandaloneBinDir();
	if (!existsSync(binDir)) {
		mkdirSync(binDir, { recursive: true });
	}

	const binPath = getStandaloneBinPath();
	const tempTar = join(tmpdir(), `superset-vscode-cli-${Date.now()}.tar.gz`);

	try {
		console.log("[vscode-serve-web] Downloading VS Code CLI...");
		const response = await fetch(downloadUrl, { redirect: "follow" });
		if (!response.ok) {
			throw new Error(
				`Download failed: ${response.status} ${response.statusText}`,
			);
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		writeFileSync(tempTar, buffer);

		const { execSync } = await import("node:child_process");
		execSync(`tar -xzf "${tempTar}" -C "${binDir}"`, { stdio: "pipe" });

		if (!existsSync(binPath)) {
			const extracted = execSync(`ls "${binDir}"`, {
				encoding: "utf-8",
			}).trim();
			const codeBin = extracted
				.split("\n")
				.find((f) => f === "code" || f === "code-tunnel");
			if (codeBin && codeBin !== "code") {
				const { renameSync } = await import("node:fs");
				renameSync(join(binDir, codeBin), binPath);
			}
		}

		chmodSync(binPath, 0o755);
		console.log("[vscode-serve-web] VS Code CLI downloaded to", binPath);
		return binPath;
	} finally {
		try {
			rmSync(tempTar, { force: true });
		} catch {}
	}
}

class VscodeServeWebManager {
	#instances = new Map<VscodeVariant, ServeWebInstance>();
	#launching = new Map<VscodeVariant, Promise<string>>();

	isInstalled(variant: VscodeVariant): boolean {
		return resolveCodeBinary(variant) !== null;
	}

	async ensureRunning(variant: VscodeVariant): Promise<string> {
		const existing = this.#instances.get(variant);
		if (existing && existing.process.exitCode === null) {
			return existing.baseUrl;
		}

		const pending = this.#launching.get(variant);
		if (pending) return pending;

		const promise = this.#launch(variant);
		this.#launching.set(variant, promise);
		try {
			return await promise;
		} finally {
			this.#launching.delete(variant);
		}
	}

	buildFolderUrl(baseUrl: string, folderPath: string): string {
		const url = new URL(baseUrl);
		url.searchParams.set("folder", folderPath);
		return url.toString();
	}

	stop(variant: VscodeVariant): void {
		const instance = this.#instances.get(variant);
		if (!instance) return;
		this.#cleanup(variant, instance);
	}

	stopAll(): void {
		for (const [variant, instance] of this.#instances) {
			this.#cleanup(variant, instance);
		}
	}

	async #launch(variant: VscodeVariant): Promise<string> {
		let binPath = resolveCodeBinary(variant);
		if (!binPath) {
			binPath = await downloadStandaloneCLI();
		}

		const child = spawn(
			binPath,
			[
				"serve-web",
				"--accept-server-license-terms",
				"--host",
				"127.0.0.1",
				"--port",
				String(SERVE_WEB_PORT),
				"--without-connection-token",
				"--commit-id",
				PINNED_COMMIT_ID,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);

		return new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				child.kill();
				reject(new Error("VS Code serve-web startup timed out (60s)"));
			}, STARTUP_TIMEOUT_MS);

			let resolved = false;

			const scan = (stream: NodeJS.ReadableStream) => {
				const rl = createInterface({ input: stream });
				rl.on("line", (line) => {
					const match = line.match(URL_PATTERN);
					if (match?.[1] && !resolved) {
						resolved = true;
						clearTimeout(timeout);
						const baseUrl = match[1];
						this.#instances.set(variant, {
							process: child,
							baseUrl,
						});
						resolve(baseUrl);
					}
				});
			};

			if (child.stdout) scan(child.stdout);
			if (child.stderr) scan(child.stderr);

			child.on("error", (err) => {
				if (!resolved) {
					clearTimeout(timeout);
					reject(err);
				}
			});

			child.on("exit", (code) => {
				if (!resolved) {
					clearTimeout(timeout);
					reject(
						new Error(`code-tunnel exited with code ${code} before serving`),
					);
				}
				this.#instances.delete(variant);
			});
		});
	}

	#cleanup(variant: VscodeVariant, instance: ServeWebInstance): void {
		this.#instances.delete(variant);
		if (instance.process.exitCode === null) {
			instance.process.kill("SIGTERM");
		}
	}
}

let manager: VscodeServeWebManager | null = null;

export function getVscodeServeWebManager(): VscodeServeWebManager {
	if (!manager) {
		manager = new VscodeServeWebManager();
	}
	return manager;
}
