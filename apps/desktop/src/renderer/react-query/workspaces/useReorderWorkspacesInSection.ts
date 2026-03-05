import { electronTrpc } from "renderer/lib/electron-trpc";

export function useReorderWorkspacesInSection(
	options?: Parameters<
		typeof electronTrpc.workspaces.reorderWorkspacesInSection.useMutation
	>[0],
) {
	const utils = electronTrpc.useUtils();

	return electronTrpc.workspaces.reorderWorkspacesInSection.useMutation({
		...options,
		onSuccess: async (...args) => {
			await utils.workspaces.getAll.invalidate();
			await utils.workspaces.getAllGrouped.invalidate();
			await utils.workspaces.getPreviousWorkspace.invalidate();
			await utils.workspaces.getNextWorkspace.invalidate();
			await options?.onSuccess?.(...args);
		},
	});
}
