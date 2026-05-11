import { string } from "@superset/cli-framework";
import { command } from "../../../../lib/command";
import { createPane, getCallerCwd } from "../../../../lib/desktop-automation";

export default command({
	description: "Open a new terminal pane",
	skipMiddleware: true,
	options: {
		workspace: string()
			.alias("w")
			.desc("Workspace ID (auto-detected if only one)"),
		cwd: string().desc("Starting directory"),
		cmd: string()
			.alias("c")
			.desc("Command to run in the terminal after creation"),
		split: string()
			.enum("right", "below")
			.alias("s")
			.desc("Split direction relative to the active pane"),
	},
	run: async ({ options }) => {
		const result = await createPane({
			type: "terminal",
			workspaceId: options.workspace ?? undefined,
			cwd: getCallerCwd(),
			split: options.split ?? undefined,
			initialCwd: options.cwd ?? undefined,
			command: options.cmd ?? undefined,
		});

		return {
			data: result,
			message: `Created terminal pane ${result.paneId} in tab ${result.tabId}${options.cmd ? ` (running: ${options.cmd})` : ""}`,
		};
	},
});
