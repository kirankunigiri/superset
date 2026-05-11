import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import Database from "better-sqlite3";
import { BrowserWindow, ipcMain } from "electron";
import type { RequestHandler } from "express";
import { Router as ExpressRouter } from "express";
import { publicProcedure, router } from "lib/trpc";
import { SUPERSET_HOME_DIR } from "main/lib/app-environment";
import { browserManager } from "main/lib/browser/browser-manager";
import type {
	AutomationPaneType,
	PaneCommand,
	PaneCommandResult,
} from "shared/pane-command-types";
import { z } from "zod";

const PANE_COMMAND_CHANNEL = "automation:pane-command";
const PANE_COMMAND_RESULT_CHANNEL = "automation:pane-command-result";
const PANE_COMMAND_TIMEOUT_MS = 5000;

const paneTypeSchema = z.enum([
	"terminal",
	"webview",
	"chat",
	"file-viewer",
	"devtools",
	"comment",
]);
const creatablePaneTypeSchema = z.enum(["terminal", "browser", "chat", "file"]);
const splitSchema = z.enum(["right", "below"]);

function getAutomationWindow(): BrowserWindow | null {
	return (
		BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
	);
}

function sendPaneCommand(
	command: Omit<PaneCommand, "requestId">,
): Promise<PaneCommandResult> {
	const window = getAutomationWindow();
	if (!window) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Desktop window is not available",
		});
	}

	const requestId = randomUUID();

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			ipcMain.removeListener(PANE_COMMAND_RESULT_CHANNEL, handler);
			reject(new Error("Pane command timed out. Is the renderer loaded?"));
		}, PANE_COMMAND_TIMEOUT_MS);

		const handler = (
			_event: Electron.IpcMainEvent,
			result: PaneCommandResult,
		) => {
			if (result.requestId !== requestId) return;
			clearTimeout(timeout);
			ipcMain.removeListener(PANE_COMMAND_RESULT_CHANNEL, handler);
			resolve(result);
		};

		ipcMain.on(PANE_COMMAND_RESULT_CHANNEL, handler);
		window.webContents.send(PANE_COMMAND_CHANNEL, { ...command, requestId });
	});
}

async function runPaneCommand(
	command: Omit<PaneCommand, "requestId">,
): Promise<PaneCommandResult> {
	const result = await sendPaneCommand(command);
	if (!result.success) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: result.error ?? "Pane command failed",
		});
	}
	return result;
}

function getWorkspaceIdForCwd(cwd: string): string | null {
	const normalizedCwd = path.resolve(cwd).toLowerCase();
	const hostDir = path.join(SUPERSET_HOME_DIR, "host");

	console.log(
		`[automation] getWorkspaceIdForCwd: hostDir=${hostDir} exists=${existsSync(hostDir)}`,
	);
	if (!existsSync(hostDir)) return null;

	for (const orgId of readdirSync(hostDir)) {
		const dbPath = path.join(hostDir, orgId, "host.db");
		if (!existsSync(dbPath)) continue;

		try {
			const db = new Database(dbPath, { readonly: true });
			const rows = db
				.prepare("SELECT id, worktree_path FROM workspaces")
				.all() as Array<{ id: string; worktree_path: string }>;
			db.close();
			console.log(
				`[automation] host DB ${orgId}: ${rows.length} workspaces, paths=[${rows.map((r) => r.worktree_path).join(", ")}]`,
			);

			for (const row of rows) {
				const resolved = path.resolve(row.worktree_path).toLowerCase();
				if (resolved === normalizedCwd) {
					console.log(
						`[automation] MATCHED workspace ${row.id} path=${row.worktree_path}`,
					);
					return row.id;
				}
			}
			console.log(`[automation] no match for normalizedCwd=${normalizedCwd}`);
		} catch {}
	}

	return null;
}

function resolveWorkspaceId(
	explicitWorkspaceId?: string,
	cwd?: string,
): string {
	if (explicitWorkspaceId) return explicitWorkspaceId;

	if (cwd) {
		const cwdWorkspaceId = getWorkspaceIdForCwd(cwd);
		if (cwdWorkspaceId) return cwdWorkspaceId;
	}

	throw new TRPCError({
		code: "PRECONDITION_FAILED",
		message:
			"Could not determine workspace. Provide a cwd that matches a workspace's project directory, or pass workspaceId explicitly.",
	});
}

export const automationRouter = router({
	panes: router({
		list: publicProcedure
			.input(
				z
					.object({
						workspaceId: z.string().min(1).optional(),
						cwd: z.string().min(1).optional(),
						type: paneTypeSchema.optional(),
					})
					.optional(),
			)
			.query(async ({ input }) => {
				const workspaceId = resolveWorkspaceId(input?.workspaceId, input?.cwd);
				const result = await runPaneCommand({
					action: "listPanes",
					workspaceId,
					type: input?.type as AutomationPaneType | undefined,
				});
				return result.panes ?? [];
			}),

		create: publicProcedure
			.input(
				z.object({
					type: creatablePaneTypeSchema,
					workspaceId: z.string().min(1).optional(),
					cwd: z.string().min(1).optional(),
					tabId: z.string().min(1).optional(),
					split: splitSchema.optional(),
					initialCwd: z.string().min(1).optional(),
					url: z.string().min(1).optional(),
					command: z.string().min(1).optional(),
					filePath: z.string().min(1).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const workspaceId = resolveWorkspaceId(input.workspaceId, input.cwd);
				const actionByType = {
					terminal: "createTerminal",
					browser: "createBrowser",
					chat: "createChat",
					file: "createFile",
				} as const satisfies Record<
					z.infer<typeof creatablePaneTypeSchema>,
					PaneCommand["action"]
				>;

				const result = await runPaneCommand({
					action: actionByType[input.type],
					workspaceId,
					tabId: input.tabId,
					split: input.split,
					initialCwd: input.initialCwd,
					url: input.url,
					command: input.command,
					filePath: input.filePath,
				});

				if (!result.tabId || !result.paneId) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Pane command succeeded without returning pane details",
					});
				}

				if (input.type === "browser" && input.cwd) {
					browserManager.registerPendingCwd(result.paneId, input.cwd);
				}

				return { tabId: result.tabId, paneId: result.paneId };
			}),

		close: publicProcedure
			.input(z.object({ paneId: z.string().min(1) }))
			.mutation(async ({ input }) => {
				await runPaneCommand({
					action: "closePane",
					paneId: input.paneId,
				});
				return { success: true };
			}),

		focus: publicProcedure
			.input(z.object({ paneId: z.string().min(1) }))
			.mutation(async ({ input }) => {
				const result = await runPaneCommand({
					action: "focusPane",
					paneId: input.paneId,
				});
				return {
					tabId: result.tabId,
					paneId: result.paneId,
				};
			}),
	}),

	terminal: router({
		read: publicProcedure
			.input(
				z.object({
					paneId: z.string().min(1),
					lines: z.number().int().positive().optional(),
				}),
			)
			.query(async ({ input }) => {
				const result = await runPaneCommand({
					action: "readTerminal",
					paneId: input.paneId,
					lines: input.lines,
				});
				return { content: result.content ?? "" };
			}),

		write: publicProcedure
			.input(
				z.object({
					paneId: z.string().min(1),
					data: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				await runPaneCommand({
					action: "writeTerminal",
					paneId: input.paneId,
					data: input.data,
				});
				return { success: true };
			}),
	}),
});

function isLocalBrowserUrl(value: string | undefined): boolean {
	if (!value) return true;
	try {
		const url = new URL(value);
		return (
			url.hostname === "127.0.0.1" ||
			url.hostname === "localhost" ||
			url.hostname === "::1"
		);
	} catch {
		return false;
	}
}

const rejectNonLocalBrowserRequests: RequestHandler = (req, res, next) => {
	const origin = req.headers.origin;
	const referer = req.headers.referer;
	if (!isLocalBrowserUrl(origin) || !isLocalBrowserUrl(referer)) {
		res.status(403).json({ error: "Desktop automation is local-only" });
		return;
	}
	if (req.method === "OPTIONS") {
		res.status(405).end();
		return;
	}
	next();
};

const automationTrpcMiddleware = createExpressMiddleware({
	router: automationRouter,
});

export const automationHttpMiddleware = ExpressRouter()
	.use(rejectNonLocalBrowserRequests)
	.use(automationTrpcMiddleware);

export type AutomationRouter = typeof automationRouter;
