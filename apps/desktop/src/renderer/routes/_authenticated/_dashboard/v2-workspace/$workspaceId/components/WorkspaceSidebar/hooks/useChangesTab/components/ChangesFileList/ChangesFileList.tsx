import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangesetFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useChangeset";
import { ChangesSection } from "./components/ChangesSection";
import { FileRow } from "./components/FileRow";

interface ChangesFileListProps {
	files: ChangesetFile[];
	workspaceId: string;
	isLoading?: boolean;
	worktreePath?: string;
	onSelectFile?: (path: string, openInNewTab?: boolean) => void;
	onOpenFile?: (absolutePath: string, openInNewTab?: boolean) => void;
	onOpenInEditor?: (path: string) => void;
}

type GroupKey = "unstaged" | "staged" | "against-base" | "commit";

const GROUP_ORDER: GroupKey[] = [
	"unstaged",
	"staged",
	"against-base",
	"commit",
];

const GROUP_TITLES: Record<GroupKey, string> = {
	unstaged: "Unstaged",
	staged: "Staged",
	"against-base": "Against base",
	commit: "Committed",
};

export const ChangesFileList = memo(function ChangesFileList({
	files,
	workspaceId,
	isLoading,
	worktreePath,
	onSelectFile,
	onOpenFile,
	onOpenInEditor,
}: ChangesFileListProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [selectedIndex, setSelectedIndex] = useState(-1);

	const grouped = useMemo(() => {
		const groups: Record<GroupKey, ChangesetFile[]> = {
			unstaged: [],
			staged: [],
			"against-base": [],
			commit: [],
		};
		for (const file of files) {
			groups[file.source.kind].push(file);
		}
		return groups;
	}, [files]);

	const flatFiles = useMemo(() => {
		const flat: ChangesetFile[] = [];
		for (const key of GROUP_ORDER) {
			flat.push(...grouped[key]);
		}
		return flat;
	}, [grouped]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (flatFiles.length === 0) return;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min(selectedIndex + 1, flatFiles.length - 1);
				setSelectedIndex(next);
				onSelectFile?.(flatFiles[next].path);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				const prev = Math.max(selectedIndex - 1, 0);
				setSelectedIndex(prev);
				onSelectFile?.(flatFiles[prev].path);
			}
		},
		[selectedIndex, flatFiles, onSelectFile],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || selectedIndex < 0) return;
		const item = container.querySelector(
			`[data-file-index="${selectedIndex}"]`,
		);
		item?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	const prevFilesRef = useRef(flatFiles);
	useEffect(() => {
		if (prevFilesRef.current !== flatFiles) {
			prevFilesRef.current = flatFiles;
			setSelectedIndex(flatFiles.length > 0 ? 0 : -1);
		}
	}, [flatFiles]);

	const handleFileClick = useCallback(
		(path: string, openInNewTab?: boolean) => {
			const idx = flatFiles.findIndex((f) => f.path === path);
			if (idx >= 0) setSelectedIndex(idx);
			onSelectFile?.(path, openInNewTab);
		},
		[flatFiles, onSelectFile],
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Loading...
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="px-3 py-6 text-center text-sm text-muted-foreground">
				No changes
			</div>
		);
	}

	let flatIndex = 0;

	return (
		<div
			ref={containerRef}
			role="listbox"
			tabIndex={0}
			onKeyDown={handleKeyDown}
			className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
		>
			{GROUP_ORDER.map((key) => {
				const groupFiles = grouped[key];
				if (groupFiles.length === 0) return null;
				const hasStagingActions = key === "unstaged" || key === "staged";
				const startIndex = flatIndex;
				flatIndex += groupFiles.length;
				return (
					<ChangesSection
						key={key}
						title={GROUP_TITLES[key]}
						count={groupFiles.length}
						stagingActions={
							hasStagingActions
								? { kind: key as "unstaged" | "staged", workspaceId }
								: undefined
						}
					>
						{groupFiles.map((file, i) => (
							<FileRow
								key={`${file.source.kind}:${file.path}`}
								file={file}
								workspaceId={workspaceId}
								worktreePath={worktreePath}
								isSelected={selectedIndex === startIndex + i}
								fileIndex={startIndex + i}
								onSelect={handleFileClick}
								onOpenFile={onOpenFile}
								onOpenInEditor={onOpenInEditor}
							/>
						))}
					</ChangesSection>
				);
			})}
		</div>
	);
});
