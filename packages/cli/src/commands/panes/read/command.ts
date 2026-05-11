import { number, positional } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { readTerminal } from "../../../lib/desktop-automation";

export default command({
	description: "Read the terminal buffer content of a pane",
	skipMiddleware: true,
	args: [positional("paneId").required().desc("Terminal pane ID")],
	options: {
		lines: number()
			.alias("n")
			.desc("Number of lines from the end (default: all)"),
	},
	run: async ({ args, options }) => {
		const paneId = args.paneId as string;
		const { content } = await readTerminal({
			paneId,
			lines: options.lines ?? undefined,
		});

		return { data: { paneId, content }, message: content };
	},
});
