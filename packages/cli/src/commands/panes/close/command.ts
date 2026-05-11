import { positional } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { closePane } from "../../../lib/desktop-automation";

export default command({
	description: "Close a pane by ID",
	skipMiddleware: true,
	args: [positional("paneId").required().desc("Pane ID to close")],
	run: async ({ args }) => {
		const paneId = args.paneId as string;
		await closePane(paneId);

		return {
			data: { paneId },
			message: `Closed pane ${paneId}`,
		};
	},
});
