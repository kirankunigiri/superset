import { string, table } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import {
	type AutomationPaneType,
	listPanes,
} from "../../../lib/desktop-automation";

export default command({
	description: "List panes in a workspace",
	skipMiddleware: true,
	options: {
		workspace: string().alias("w").desc("Workspace ID"),
		type: string()
			.enum("terminal", "webview", "chat", "file-viewer", "devtools", "comment")
			.desc("Filter by pane type"),
	},
	display: (data) =>
		table(
			data as Record<string, unknown>[],
			["id", "tabId", "type", "name", "detail"],
			["ID", "TAB", "TYPE", "NAME", "CWD/URL"],
		),
	run: async ({ options }) => {
		const panes = await listPanes({
			workspaceId: options.workspace ?? undefined,
			type: (options.type as AutomationPaneType | undefined) ?? undefined,
		});

		return panes.map((p) => ({
			...p,
			detail: p.url || p.cwd || "—",
		}));
	},
});
