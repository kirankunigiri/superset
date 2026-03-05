import { electronTrpc } from "renderer/lib/electron-trpc";

export function useReorderSections(
	options?: Parameters<
		typeof electronTrpc.workspaces.reorderSections.useMutation
	>[0],
) {
	const utils = electronTrpc.useUtils();

	return electronTrpc.workspaces.reorderSections.useMutation({
		...options,
		onSuccess: async (...args) => {
			await utils.workspaces.getAllGrouped.invalidate();
			await utils.workspaces.getPreviousWorkspace.invalidate();
			await utils.workspaces.getNextWorkspace.invalidate();
			await options?.onSuccess?.(...args);
		},
	});
}
