import { positional, string } from "@superset/cli-framework";
import { command } from "../../../../lib/command";
import { createPane, getCallerCwd } from "../../../../lib/desktop-automation";

export default command({
	description: "Open a file in the editor",
	skipMiddleware: true,
	args: [positional("filePath").required().desc("Absolute path to the file")],
	options: {
		workspace: string()
			.alias("w")
			.desc("Workspace ID (auto-detected if only one)"),
		split: string()
			.enum("right", "below")
			.alias("s")
			.desc("Split direction relative to the active pane"),
	},
	run: async ({ args, options }) => {
		const result = await createPane({
			type: "file",
			workspaceId: options.workspace ?? undefined,
			cwd: getCallerCwd(),
			split: options.split ?? undefined,
			filePath: args.filePath as string,
		});

		return {
			data: result,
			message: `Opened file pane ${result.paneId} in tab ${result.tabId}`,
		};
	},
});
