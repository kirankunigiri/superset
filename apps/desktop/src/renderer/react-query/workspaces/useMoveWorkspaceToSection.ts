import { toast } from "@superset/ui/sonner";
import { electronTrpc } from "renderer/lib/electron-trpc";

export function useMoveWorkspaceToSection() {
	const utils = electronTrpc.useUtils();

	return electronTrpc.workspaces.moveWorkspaceToSection.useMutation({
		onSuccess: () => utils.workspaces.getAllGrouped.invalidate(),
		onError: (error) =>
			toast.error(`Failed to move workspace: ${error.message}`),
	});
}
