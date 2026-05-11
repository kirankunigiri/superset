import { cn } from "@superset/ui/utils";
import { GitCommitHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { ChangesFilter } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import type { Commit } from "../../types";

interface CommitListProps {
	commits: Commit[];
	filter: ChangesFilter;
	onFilterChange: (filter: ChangesFilter) => void;
	uncommittedCount: number;
}

export function CommitList({
	commits,
	filter,
	onFilterChange,
	uncommittedCount,
}: CommitListProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const commitIdx =
		filter.kind === "commit"
			? commits.findIndex((c) => c.hash === filter.hash)
			: -1;
	const selectedIndex = commitIdx >= 0 ? commitIdx + 1 : 0;
	const itemCount = commits.length + 1;

	const selectItem = useCallback(
		(index: number) => {
			if (index === 0) {
				onFilterChange({ kind: "uncommitted" });
			} else {
				const commit = commits[index - 1];
				if (commit) onFilterChange({ kind: "commit", hash: commit.hash });
			}
		},
		[commits, onFilterChange],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				selectItem(Math.min(selectedIndex + 1, itemCount - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				selectItem(Math.max(selectedIndex - 1, 0));
			}
		},
		[selectedIndex, itemCount, selectItem],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const item = container.querySelector(`[data-index="${selectedIndex}"]`);
		item?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	return (
		<div
			ref={containerRef}
			role="listbox"
			tabIndex={0}
			onKeyDown={handleKeyDown}
			className="max-h-[180px] overflow-y-auto border-b border-border focus:outline-none"
		>
			<button
				type="button"
				data-index={0}
				onClick={() => selectItem(0)}
				className={cn(
					"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none",
					"hover:bg-accent",
					selectedIndex === 0 && "bg-accent/60",
				)}
			>
				<GitCommitHorizontal className="size-3 shrink-0 text-muted-foreground" />
				<span className="truncate">Active changes</span>
				{uncommittedCount > 0 && (
					<span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
						{uncommittedCount}
					</span>
				)}
			</button>

			{commits.map((commit, i) => {
				const index = i + 1;
				return (
					<button
						type="button"
						key={commit.hash}
						data-index={index}
						onClick={() => selectItem(index)}
						className={cn(
							"flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs outline-none",
							"hover:bg-accent",
							selectedIndex === index && "bg-accent/60",
						)}
					>
						<div className="min-w-0 flex-1">
							<div className="truncate">{commit.message}</div>
							<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
								<div className="flex shrink-0 -space-x-1.5">
									{(commit.authors ?? [{ email: commit.email }]).map(
										(a, idx) => (
											<img
												key={a.email}
												src={`https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(a.email)}&s=20`}
												alt=""
												className="size-3 rounded-full ring-1 ring-background"
												style={{ zIndex: 10 - idx }}
											/>
										),
									)}
								</div>
								<span className="truncate">
									{(commit.authors ?? [{ name: commit.author }])
										.map((a) => a.name)
										.join(", ")}
								</span>
								{(commit.additions > 0 || commit.deletions > 0) && (
									<>
										<span>·</span>
										{commit.additions > 0 && (
											<span className="text-green-400">
												+{commit.additions}
											</span>
										)}
										{commit.deletions > 0 && (
											<span className="text-red-400">-{commit.deletions}</span>
										)}
									</>
								)}
							</div>
						</div>
						{commit.filesChanged > 0 && (
							<span className="mt-0.5 shrink-0 text-[10px] text-muted-foreground">
								{commit.filesChanged}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
