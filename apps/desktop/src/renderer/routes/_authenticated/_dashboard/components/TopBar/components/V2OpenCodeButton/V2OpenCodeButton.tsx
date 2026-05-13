import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback } from "react";
import openCodeIcon from "renderer/assets/app-icons/opencode.png";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { getV2PaneStore } from "renderer/lib/v2-pane-store-registry";
import { useCollections } from "../../../../../providers/CollectionsProvider";
import { useLocalHostService } from "../../../../../providers/LocalHostServiceProvider";

interface V2OpenCodeButtonProps {
	workspaceId: string;
}

export function V2OpenCodeButton({ workspaceId }: V2OpenCodeButtonProps) {
	const collections = useCollections();
	const { activeHostUrl } = useLocalHostService();

	const { data: workspaces = [] } = useLiveQuery(
		(q) =>
			q
				.from({ workspaces: collections.v2Workspaces })
				.where(({ workspaces }) => eq(workspaces.id, workspaceId))
				.select(({ workspaces }) => ({
					id: workspaces.id,
					hostId: workspaces.hostId,
				})),
		[collections, workspaceId],
	);
	const workspace = workspaces[0] ?? null;

	const workspaceQuery = useQuery({
		queryKey: ["v2-opencode-workspace", activeHostUrl, workspaceId],
		queryFn: () =>
			getHostServiceClientByUrl(activeHostUrl as string).workspace.get.query({
				id: workspaceId,
			}),
		enabled: !!workspace && !!activeHostUrl,
	});

	const mutation = electronTrpc.openCode.getUrl.useMutation({
		onError: (error) =>
			toast.error("Failed to open OpenCode", {
				description: error.message,
			}),
	});

	const handleClick = useCallback(async () => {
		const worktreePath = workspaceQuery.data?.worktreePath;
		if (!worktreePath || mutation.isPending) return;
		const result = await mutation.mutateAsync({
			folderPath: worktreePath,
		});
		const store = getV2PaneStore(workspaceId);
		if (store) {
			store.getState().addTab({
				panes: [{ kind: "browser", data: { url: result.url } }],
			});
		}
	}, [workspaceQuery.data?.worktreePath, workspaceId, mutation]);

	if (!workspace || !activeHostUrl || !workspaceQuery.data?.worktreePath) {
		return null;
	}

	const isLoading = mutation.isPending;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={handleClick}
					disabled={isLoading}
					aria-label="Open OpenCode"
					className={cn(
						"no-drag flex items-center justify-center h-6 w-6 rounded",
						"text-muted-foreground",
						"transition-all duration-150 ease-out",
						"hover:text-foreground hover:bg-secondary/50",
						"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						"active:scale-[0.98]",
						isLoading && "pointer-events-none",
					)}
				>
					{isLoading ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<img
							src={openCodeIcon}
							alt=""
							className="size-3.5 object-contain"
						/>
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom" sideOffset={6}>
				{isLoading ? "Starting OpenCode..." : "Open OpenCode"}
			</TooltipContent>
		</Tooltip>
	);
}
