export type AutomationPaneType =
	| "terminal"
	| "webview"
	| "chat"
	| "file-viewer"
	| "devtools"
	| "comment";

export interface AutomationPaneRow {
	id: string;
	tabId: string;
	workspaceId: string;
	type: AutomationPaneType;
	name: string;
	cwd?: string;
	url?: string;
}
