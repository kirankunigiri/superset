import { LuPlus } from "react-icons/lu";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";

export function V2SidebarHeader() {
	const openModal = useOpenNewWorkspaceModal();

	return (
		<div className="flex items-center justify-between border-b border-border px-3 py-2">
			<div>
				<div className="text-sm font-medium">Workspaces</div>
				<div className="text-xs text-muted-foreground">V2 Cloud</div>
			</div>
			<button
				type="button"
				onClick={() => openModal()}
				className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
			>
				<LuPlus className="size-4" />
			</button>
		</div>
	);
}
