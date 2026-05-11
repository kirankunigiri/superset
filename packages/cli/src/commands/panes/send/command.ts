import { positional } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { writeTerminal } from "../../../lib/desktop-automation";

export default command({
	description: "Send a command to a terminal pane",
	skipMiddleware: true,
	args: [
		positional("paneId").required().desc("Terminal pane ID"),
		positional("cmd").required().desc("Command to send"),
	],
	run: async ({ args }) => {
		const paneId = args.paneId as string;
		const cmd = args.cmd as string;

		await writeTerminal({
			paneId,
			data: `${cmd}\n`,
		});

		return {
			data: { paneId, cmd },
			message: `Sent command to pane ${paneId}: ${cmd}`,
		};
	},
});
