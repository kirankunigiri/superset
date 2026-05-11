import { positional } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { focusPane } from "../../../lib/desktop-automation";

export default command({
	description: "Focus a pane by ID",
	skipMiddleware: true,
	args: [positional("paneId").required().desc("Pane ID to focus")],
	run: async ({ args }) => {
		const paneId = args.paneId as string;
		const result = await focusPane(paneId);

		return {
			data: result,
			message: `Focused pane ${paneId} in tab ${result.tabId}`,
		};
	},
});
