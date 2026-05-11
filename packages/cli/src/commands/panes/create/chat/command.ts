import { string } from "@superset/cli-framework";
import { command } from "../../../../lib/command";
import { createPane, getCallerCwd } from "../../../../lib/desktop-automation";

export default command({
	description: "Open a new chat pane",
	skipMiddleware: true,
	options: {
		workspace: string()
			.alias("w")
			.desc("Workspace ID (auto-detected if only one)"),
		split: string()
			.enum("right", "below")
			.alias("s")
			.desc("Split direction relative to the active pane"),
	},
	run: async ({ options }) => {
		const result = await createPane({
			type: "chat",
			workspaceId: options.workspace ?? undefined,
			cwd: getCallerCwd(),
			split: options.split ?? undefined,
		});

		return {
			data: result,
			message: `Created chat pane ${result.paneId} in tab ${result.tabId}`,
		};
	},
});
