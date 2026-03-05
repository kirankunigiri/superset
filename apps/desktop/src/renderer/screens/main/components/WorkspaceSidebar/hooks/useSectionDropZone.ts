import { useCallback, useEffect, useRef, useState } from "react";
import { useMoveWorkspaceToSection } from "renderer/react-query/workspaces";
import { getActiveDragItem } from "renderer/stores/active-drag-item";
import type { DragItem } from "../types";

interface UseSectionDropZoneOptions {
	canAccept: (item: DragItem) => boolean;
	targetSectionId: string | null;
	onAutoExpand?: () => void;
}

export function useSectionDropZone({
	canAccept,
	targetSectionId,
	onAutoExpand,
}: UseSectionDropZoneOptions) {
	const [isDragOver, setIsDragOver] = useState(false);
	const dragEnterCount = useRef(0);
	const autoExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const moveToSection = useMoveWorkspaceToSection();

	useEffect(() => {
		return () => {
			if (autoExpandTimer.current) clearTimeout(autoExpandTimer.current);
		};
	}, []);

	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			const item = getActiveDragItem();
			if (item && canAccept(item)) {
				e.preventDefault();
			}
		},
		[canAccept],
	);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			const item = getActiveDragItem();
			if (item && canAccept(item)) {
				moveToSection.mutate({
					workspaceId: item.id,
					sectionId: targetSectionId,
				});
				item.handled = true;
			}
			dragEnterCount.current = 0;
			setIsDragOver(false);
		},
		[canAccept, targetSectionId, moveToSection],
	);

	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			dragEnterCount.current++;
			const item = getActiveDragItem();
			if (item && canAccept(item)) {
				setIsDragOver(true);
				if (onAutoExpand && !autoExpandTimer.current) {
					autoExpandTimer.current = setTimeout(() => {
						onAutoExpand();
						autoExpandTimer.current = null;
					}, 600);
				}
			}
		},
		[canAccept, onAutoExpand],
	);

	const handleDragLeave = useCallback(() => {
		dragEnterCount.current--;
		if (dragEnterCount.current <= 0) {
			dragEnterCount.current = 0;
			setIsDragOver(false);
			if (autoExpandTimer.current) {
				clearTimeout(autoExpandTimer.current);
				autoExpandTimer.current = null;
			}
		}
	}, []);

	const handleDragEnd = useCallback(() => {
		dragEnterCount.current = 0;
		setIsDragOver(false);
		if (autoExpandTimer.current) {
			clearTimeout(autoExpandTimer.current);
			autoExpandTimer.current = null;
		}
	}, []);

	return {
		isDragOver,
		handlers: {
			onDragOver: handleDragOver,
			onDrop: handleDrop,
			onDragEnter: handleDragEnter,
			onDragLeave: handleDragLeave,
			onDragEnd: handleDragEnd,
		},
	};
}
