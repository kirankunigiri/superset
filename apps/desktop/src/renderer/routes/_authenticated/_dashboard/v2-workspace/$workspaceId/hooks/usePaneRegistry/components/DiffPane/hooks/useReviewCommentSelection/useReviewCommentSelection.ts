import type { SelectedLineRange } from "@pierre/diffs";
import { useCallback, useState } from "react";

export interface ReviewSelection {
	range: SelectedLineRange;
	code: string;
	startLine: number;
	endLine: number;
}

interface UseReviewCommentSelectionOptions {
	fileContents: string | undefined;
}

export function useReviewCommentSelection({
	fileContents,
}: UseReviewCommentSelectionOptions) {
	const [selection, setSelection] = useState<ReviewSelection | null>(null);

	const onLineSelectionEnd = useCallback(
		(range: SelectedLineRange | null) => {
			if (!range || !fileContents) {
				setSelection(null);
				return;
			}
			const start = Math.min(range.start, range.end);
			const end = Math.max(range.start, range.end);
			const lines = fileContents.split("\n");
			const clamped = lines.slice(
				Math.max(0, start - 1),
				Math.min(lines.length, end),
			);
			setSelection({
				range,
				code: clamped.join("\n"),
				startLine: start,
				endLine: end,
			});
		},
		[fileContents],
	);

	const clearSelection = useCallback(() => setSelection(null), []);

	return {
		selection,
		selectedLines: selection?.range ?? null,
		onLineSelectionEnd,
		clearSelection,
	};
}
