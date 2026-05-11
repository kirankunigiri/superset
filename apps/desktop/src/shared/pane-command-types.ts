import type {
	AutomationPaneRow,
	AutomationPaneType,
} from "@superset/shared/automation-types";

export type { AutomationPaneRow, AutomationPaneType };

export interface PaneCommand {
	requestId: string;
	action:
		| "listPanes"
		| "createTerminal"
		| "createBrowser"
		| "createChat"
		| "createFile"
		| "closePane"
		| "focusPane"
		| "readTerminal"
		| "writeTerminal"
		| "getCurrentWorkspace";
	workspaceId?: string;
	paneId?: string;
	tabId?: string;
	type?: AutomationPaneType;
	split?: "right" | "below";
	initialCwd?: string;
	url?: string;
	lines?: number;
	data?: string;
	command?: string;
	filePath?: string;
}

export interface PaneCommandResult {
	requestId: string;
	success: boolean;
	tabId?: string;
	paneId?: string;
	workspaceId?: string;
	panes?: AutomationPaneRow[];
	content?: string;
	error?: string;
}
