import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import {
	getV2HostUrl,
	getV2PaneStore,
	getV2PaneStores,
} from "renderer/lib/v2-pane-store-registry";
import { navigateToWorkspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { NOTIFICATION_EVENTS } from "shared/constants";
import { debugLog } from "shared/debug";
import type {
	AutomationPaneRow,
	AutomationPaneType,
	PaneCommand,
	PaneCommandResult,
} from "shared/pane-command-types";
import { useTabsStore } from "./store";
import { resolveNotificationTarget } from "./utils/resolve-notification-target";

const KIND_TO_TYPE: Record<string, AutomationPaneType> = {
	terminal: "terminal",
	browser: "webview",
	chat: "chat",
	file: "file-viewer",
	devtools: "devtools",
	comment: "comment",
};

function requireWorkspaceId(command: PaneCommand): string {
	if (!command.workspaceId) {
		throw new Error("Missing workspaceId");
	}
	return command.workspaceId;
}

function requirePaneId(command: PaneCommand): string {
	if (!command.paneId) {
		throw new Error("Missing paneId");
	}
	return command.paneId;
}

function listPaneRows(command: PaneCommand): AutomationPaneRow[] {
	const stores = getV2PaneStores();
	const rows: AutomationPaneRow[] = [];

	for (const [workspaceId, store] of stores) {
		if (command.workspaceId && command.workspaceId !== workspaceId) continue;
		const state = store.getState();
		for (const tab of state.tabs) {
			for (const pane of Object.values(tab.panes)) {
				const paneType = KIND_TO_TYPE[pane.kind];
				if (!paneType) continue;
				if (command.type && paneType !== command.type) continue;

				const data = pane.data as unknown as Record<string, unknown>;
				rows.push({
					id: pane.id,
					tabId: tab.id,
					workspaceId,
					type: paneType,
					name: pane.titleOverride ?? pane.kind,
					url: typeof data?.url === "string" ? data.url : undefined,
				});
			}
		}
	}
	return rows;
}

async function handlePaneCommand(command: PaneCommand): Promise<void> {
	let result: PaneCommandResult;

	try {
		switch (command.action) {
			case "listPanes": {
				result = {
					requestId: command.requestId,
					success: true,
					panes: listPaneRows(command),
				};
				break;
			}
			case "createTerminal": {
				const workspaceId = requireWorkspaceId(command);
				const store = getV2PaneStore(workspaceId);
				if (!store) throw new Error("Workspace not mounted");
				const hostUrl = getV2HostUrl(workspaceId);
				if (!hostUrl) throw new Error("Host service URL not available");

				const terminalId = crypto.randomUUID();
				const paneId = `pane-${Date.now()}-${terminalId.slice(0, 8)}`;
				const tabId = `tab-${Date.now()}-${terminalId.slice(0, 8)}`;
				const hostClient = getHostServiceClientByUrl(hostUrl);
				await hostClient.terminal.createSession.mutate({
					terminalId,
					workspaceId,
					themeType: "dark",
					cwd: command.initialCwd,
					initialCommand: command.command,
				});
				const newPane = {
					id: paneId,
					kind: "terminal" as const,
					data: { terminalId },
				};
				const state = store.getState();
				if (command.split) {
					const activeTab = state.getActiveTab();
					if (!activeTab) throw new Error("No active tab");
					const activePane = state.getActivePane(activeTab.id);
					if (!activePane) throw new Error("No active pane");
					state.splitPane({
						tabId: activeTab.id,
						paneId: activePane.pane.id,
						position: command.split === "below" ? "bottom" : "right",
						newPane,
						selectNewPane: true,
					});
					result = {
						requestId: command.requestId,
						success: true,
						tabId: activeTab.id,
						paneId,
					};
				} else {
					state.addTab({ id: tabId, panes: [newPane] });
					result = {
						requestId: command.requestId,
						success: true,
						tabId,
						paneId,
					};
				}
				break;
			}
			case "createBrowser": {
				const workspaceId = requireWorkspaceId(command);
				const store = getV2PaneStore(workspaceId);
				if (!store) throw new Error("Workspace not mounted");

				const paneId = `pane-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
				const state = store.getState();
				if (command.split) {
					const activeTab = state.getActiveTab();
					if (!activeTab) throw new Error("No active tab");
					const activePane = state.getActivePane(activeTab.id);
					if (!activePane) throw new Error("No active pane");
					state.splitPane({
						tabId: activeTab.id,
						paneId: activePane.pane.id,
						position: command.split === "below" ? "bottom" : "right",
						newPane: {
							id: paneId,
							kind: "browser",
							data: { url: command.url ?? "about:blank" },
						},
						selectNewPane: true,
					});
					result = {
						requestId: command.requestId,
						success: true,
						tabId: activeTab.id,
						paneId,
					};
				} else {
					const tabId = `tab-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
					state.addTab({
						id: tabId,
						panes: [
							{
								id: paneId,
								kind: "browser",
								data: { url: command.url ?? "about:blank" },
							},
						],
					});
					result = {
						requestId: command.requestId,
						success: true,
						tabId,
						paneId,
					};
				}
				break;
			}
			case "createChat": {
				const workspaceId = requireWorkspaceId(command);
				const store = getV2PaneStore(workspaceId);
				if (!store) throw new Error("Workspace not mounted");

				const paneId = `pane-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
				const state = store.getState();
				if (command.split) {
					const activeTab = state.getActiveTab();
					if (!activeTab) throw new Error("No active tab");
					const activePane = state.getActivePane(activeTab.id);
					if (!activePane) throw new Error("No active pane");
					state.splitPane({
						tabId: activeTab.id,
						paneId: activePane.pane.id,
						position: command.split === "below" ? "bottom" : "right",
						newPane: {
							id: paneId,
							kind: "chat",
							data: { sessionId: null },
						},
						selectNewPane: true,
					});
					result = {
						requestId: command.requestId,
						success: true,
						tabId: activeTab.id,
						paneId,
					};
				} else {
					const tabId = `tab-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
					state.addTab({
						id: tabId,
						panes: [
							{
								id: paneId,
								kind: "chat",
								data: { sessionId: null },
							},
						],
					});
					result = {
						requestId: command.requestId,
						success: true,
						tabId,
						paneId,
					};
				}
				break;
			}
			case "createFile": {
				const workspaceId = requireWorkspaceId(command);
				const store = getV2PaneStore(workspaceId);
				if (!store) throw new Error("Workspace not mounted");
				if (!command.filePath) throw new Error("Missing filePath");

				const paneId = `pane-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
				const newPane = {
					id: paneId,
					kind: "file" as const,
					data: { filePath: command.filePath, mode: "editor" as const },
				};
				const state = store.getState();
				if (command.split) {
					const activeTab = state.getActiveTab();
					if (!activeTab) throw new Error("No active tab");
					const activePane = state.getActivePane(activeTab.id);
					if (!activePane) throw new Error("No active pane");
					state.splitPane({
						tabId: activeTab.id,
						paneId: activePane.pane.id,
						position: command.split === "below" ? "bottom" : "right",
						newPane,
						selectNewPane: true,
					});
					result = {
						requestId: command.requestId,
						success: true,
						tabId: activeTab.id,
						paneId,
					};
				} else {
					const tabId = `tab-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
					state.addTab({ id: tabId, panes: [newPane] });
					result = {
						requestId: command.requestId,
						success: true,
						tabId,
						paneId,
					};
				}
				break;
			}
			case "closePane": {
				const paneId = requirePaneId(command);
				const stores = getV2PaneStores();
				let found = false;
				for (const store of stores.values()) {
					const location = store.getState().getPane(paneId);
					if (location) {
						store.getState().closePane({
							tabId: location.tabId,
							paneId,
						});
						found = true;
						break;
					}
				}
				if (!found) throw new Error(`Pane not found: ${paneId}`);
				result = {
					requestId: command.requestId,
					success: true,
					paneId,
				};
				break;
			}
			case "focusPane": {
				const paneId = requirePaneId(command);
				const stores = getV2PaneStores();
				let foundTabId: string | undefined;
				for (const store of stores.values()) {
					const location = store.getState().getPane(paneId);
					if (location) {
						store.getState().setActiveTab(location.tabId);
						store.getState().setActivePane({ tabId: location.tabId, paneId });
						foundTabId = location.tabId;
						break;
					}
				}
				if (!foundTabId) throw new Error(`Pane not found: ${paneId}`);
				result = {
					requestId: command.requestId,
					success: true,
					tabId: foundTabId,
					paneId,
				};
				break;
			}
			case "readTerminal": {
				const paneId = requirePaneId(command);
				let terminalId: string | undefined;
				for (const store of getV2PaneStores().values()) {
					const location = store.getState().getPane(paneId);
					if (location && location.pane.kind === "terminal") {
						terminalId = (location.pane.data as { terminalId?: string })
							.terminalId;
						break;
					}
				}
				const terminal = terminalRuntimeRegistry.getTerminal(
					terminalId ?? paneId,
				);
				if (!terminal) throw new Error("Terminal is not mounted");

				const buffer = terminal.buffer.active;
				const lines: string[] = [];
				for (let i = 0; i <= buffer.baseY + buffer.cursorY; i += 1) {
					const line = buffer.getLine(i);
					if (line) lines.push(line.translateToString(true));
				}

				const content =
					command.lines && command.lines > 0
						? lines.slice(-command.lines).join("\n")
						: lines.join("\n");
				result = {
					requestId: command.requestId,
					success: true,
					paneId,
					content,
				};
				break;
			}
			case "writeTerminal": {
				const paneId = requirePaneId(command);
				if (!command.data) throw new Error("Missing data");
				let terminalId: string | undefined;
				for (const store of getV2PaneStores().values()) {
					const location = store.getState().getPane(paneId);
					if (location && location.pane.kind === "terminal") {
						terminalId = (location.pane.data as { terminalId?: string })
							.terminalId;
						break;
					}
				}
				if (!terminalId) throw new Error(`Terminal pane not found: ${paneId}`);
				terminalRuntimeRegistry.writeInput(terminalId, command.data);
				result = {
					requestId: command.requestId,
					success: true,
					paneId,
				};
				break;
			}
			case "getCurrentWorkspace": {
				const match = window.location.hash.match(
					/\/(?:workspace|v2-workspace)\/([^/?#]+)/,
				);
				result = {
					requestId: command.requestId,
					success: true,
					workspaceId: match?.[1] ?? undefined,
				};
				break;
			}
			case "getWorkspaceForCwd": {
				if (!command.cwd) throw new Error("Missing cwd");
				const targetCwd = command.cwd.toLowerCase();
				let matchedWorkspaceId: string | undefined;
				const stores = getV2PaneStores();
				console.log(
					`[getWorkspaceForCwd] searching ${stores.size} workspaces for cwd=${command.cwd}`,
				);
				for (const [wsId] of stores) {
					const hostUrl = getV2HostUrl(wsId);
					if (!hostUrl) {
						console.log(`[getWorkspaceForCwd] ${wsId}: no hostUrl`);
						continue;
					}
					try {
						const client = getHostServiceClientByUrl(hostUrl);
						const info = await client.workspace.get.query({ id: wsId });
						console.log(
							`[getWorkspaceForCwd] ${wsId}: worktreePath=${info?.worktreePath}`,
						);
						if (info?.worktreePath?.toLowerCase() === targetCwd) {
							matchedWorkspaceId = wsId;
							break;
						}
					} catch (err) {
						console.log(`[getWorkspaceForCwd] ${wsId}: query failed`, err);
					}
				}
				result = {
					requestId: command.requestId,
					success: true,
					workspaceId: matchedWorkspaceId,
				};
				break;
			}
			default:
				throw new Error(`Unknown pane command: ${command.action}`);
		}
	} catch (err) {
		result = {
			requestId: command.requestId,
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	window.ipcRenderer.send("automation:pane-command-result", result);
}

function getCurrentWorkspaceId(): string | null {
	try {
		const match = window.location.hash.match(
			/\/(?:workspace|v2-workspace)\/([^/?#]+)/,
		);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

export function useAgentHookListener() {
	const navigate = useNavigate();

	useEffect(() => {
		window.ipcRenderer.on("automation:pane-command", handlePaneCommand);
		return () => {
			window.ipcRenderer.off("automation:pane-command", handlePaneCommand);
		};
	}, []);

	electronTrpc.notifications.subscribe.useSubscription(undefined, {
		onData: (event) => {
			if (!event.data) return;
			if (event.type === NOTIFICATION_EVENTS.FOCUS_V2_NOTIFICATION_SOURCE) {
				return;
			}

			const state = useTabsStore.getState();
			const target = resolveNotificationTarget(event.data, state);
			if (!target) return;

			const { paneId, workspaceId } = target;

			if (event.type === NOTIFICATION_EVENTS.AGENT_LIFECYCLE) {
				if (!paneId) return;

				const lifecycleEvent = event.data;
				if (!lifecycleEvent) return;

				const { eventType } = lifecycleEvent;

				if (eventType === "Start") {
					state.setPaneStatus(paneId, "working");
				} else if (
					eventType === "PermissionRequest" ||
					eventType === "PendingQuestion"
				) {
					state.setPaneStatus(paneId, "permission");
				} else if (eventType === "Stop") {
					const activeTabId = state.activeTabIds[workspaceId];
					const pane = state.panes[paneId];
					const tabId = pane?.tabId;
					const isTabActive = tabId != null && tabId === activeTabId;
					const isPaneFocused =
						tabId != null && state.focusedPaneIds[tabId] === paneId;
					const isInActiveTab =
						isTabActive &&
						(getCurrentWorkspaceId() === workspaceId || isPaneFocused);

					const nextStatus =
						pane?.status === "permission"
							? "idle"
							: isInActiveTab
								? "idle"
								: "review";

					debugLog("agent-hooks", "Stop event:", {
						isInActiveTab,
						activeTabId,
						paneTabId: pane?.tabId,
						paneId,
						paneStatus: pane?.status,
						willSetTo: nextStatus,
					});

					state.setPaneStatus(paneId, nextStatus);
				}
			} else if (event.type === NOTIFICATION_EVENTS.TERMINAL_EXIT) {
				if (!paneId) return;
				const currentPane = state.panes[paneId];
				if (
					currentPane?.status === "working" ||
					currentPane?.status === "permission"
				) {
					state.setPaneStatus(paneId, "idle");
				}
			} else if (event.type === NOTIFICATION_EVENTS.FOCUS_TAB) {
				navigateToWorkspace(workspaceId, navigate, {
					search: {
						tabId: target.tabId,
						paneId: target.paneId,
					},
				});
			}
		},
	});
}
