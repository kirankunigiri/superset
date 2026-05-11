import { CLIError } from "@superset/cli-framework";
import type {
	AutomationPaneRow,
	AutomationPaneType,
} from "@superset/shared/automation-types";
import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";

export type { AutomationPaneRow, AutomationPaneType };

export function getCallerCwd(): string {
	return process.env.SUPERSET_CLI_CWD || process.cwd();
}

const DEFAULT_AUTOMATION_PORT = 51741;

export interface PaneResult {
	tabId: string;
	paneId: string;
}

function getAutomationPort(): number {
	const envPort = process.env.DESKTOP_NOTIFICATIONS_PORT;
	if (envPort) return Number.parseInt(envPort, 10);
	return DEFAULT_AUTOMATION_PORT;
}

function getAutomationBaseUrl(): string {
	return `http://127.0.0.1:${getAutomationPort()}/automation/trpc`;
}

function createAutomationClient() {
	return createTRPCUntypedClient({
		links: [
			httpBatchLink({
				url: getAutomationBaseUrl(),
				transformer: SuperJSON,
			}),
		],
	});
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function automationQuery<T>(path: string, input?: unknown): Promise<T> {
	try {
		return (await createAutomationClient().query(path, input)) as T;
	} catch (error) {
		throw new CLIError(
			"Desktop automation request failed",
			`${getErrorMessage(error)}\nMake sure the desktop app is running.`,
		);
	}
}

async function automationMutation<T>(
	path: string,
	input?: unknown,
): Promise<T> {
	try {
		return (await createAutomationClient().mutation(path, input)) as T;
	} catch (error) {
		throw new CLIError(
			"Desktop automation request failed",
			`${getErrorMessage(error)}\nMake sure the desktop app is running.`,
		);
	}
}

export function listPanes(input: {
	workspaceId?: string;
	cwd?: string;
	type?: AutomationPaneType;
}): Promise<AutomationPaneRow[]> {
	return automationQuery("panes.list", input);
}

export function createPane(input: {
	type: "terminal" | "browser" | "chat" | "file";
	workspaceId?: string;
	cwd?: string;
	tabId?: string;
	split?: "right" | "below";
	initialCwd?: string;
	url?: string;
	command?: string;
	filePath?: string;
}): Promise<PaneResult> {
	return automationMutation("panes.create", input);
}

export function closePane(paneId: string): Promise<{ success: boolean }> {
	return automationMutation("panes.close", { paneId });
}

export function focusPane(paneId: string): Promise<Partial<PaneResult>> {
	return automationMutation("panes.focus", { paneId });
}

export function readTerminal(input: {
	paneId: string;
	lines?: number;
}): Promise<{ content: string }> {
	return automationQuery("terminal.read", input);
}

export function writeTerminal(input: {
	paneId: string;
	data: string;
}): Promise<{ success: boolean }> {
	return automationMutation("terminal.write", input);
}
