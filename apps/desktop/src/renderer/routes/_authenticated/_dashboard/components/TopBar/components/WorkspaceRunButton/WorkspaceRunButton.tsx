import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { memo, useCallback } from "react";
import { HiMiniPlay, HiMiniStop } from "react-icons/hi2";
import { useWorkspaceRunCommand } from "renderer/routes/_authenticated/_dashboard/workspace/$workspaceId/hooks/useWorkspaceRunCommand";
import { useHotkeyText } from "renderer/stores/hotkeys";

interface WorkspaceRunButtonProps {
	workspaceId: string;
	worktreePath?: string | null;
}

export const WorkspaceRunButton = memo(function WorkspaceRunButton({
	workspaceId,
	worktreePath,
}: WorkspaceRunButtonProps) {
	const { isRunning, isPending, toggleWorkspaceRun } = useWorkspaceRunCommand({
		workspaceId,
		worktreePath,
	});
	const runShortcut = useHotkeyText("RUN_WORKSPACE_COMMAND");
	const showRunShortcut = runShortcut !== "Unassigned";

	const handleClick = useCallback(() => {
		void toggleWorkspaceRun();
	}, [toggleWorkspaceRun]);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={handleClick}
					disabled={isPending}
					aria-label={
						isRunning ? "Stop workspace run command" : "Run workspace command"
					}
					className={cn(
						"no-drag flex items-center gap-1.5 h-6 px-2 rounded border border-border/60 bg-secondary/50 text-xs font-medium",
						"transition-all duration-150 ease-out",
						"hover:bg-secondary hover:border-border",
						"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						"active:scale-[0.98]",
						isPending && "opacity-50 pointer-events-none",
						isRunning
							? "text-emerald-300 border-emerald-500/25 bg-emerald-500/10"
							: "text-foreground",
					)}
				>
					{isRunning ? (
						<HiMiniStop className="size-3.5 shrink-0" />
					) : (
						<HiMiniPlay className="size-3.5 shrink-0" />
					)}
					<span>{isRunning ? "Stop" : "Run"}</span>
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom" sideOffset={6}>
				<div className="flex items-center gap-1.5">
					<span>
						{isRunning ? "Stop workspace run command" : "Run workspace command"}
					</span>
					{showRunShortcut && (
						<kbd className="px-1 py-0.5 text-[10px] font-mono bg-foreground/10 text-foreground/70 rounded">
							{runShortcut}
						</kbd>
					)}
				</div>
			</TooltipContent>
		</Tooltip>
	);
});
