/**
 * Traverses all text nodes under `container` and returns a Range for every
 * non-overlapping occurrence of `query`.  Used by useTextSearch to build the
 * initial set of CSS Highlight ranges on each keystroke.
 */
export function collectSearchRanges(
	container: HTMLElement,
	query: string,
	caseSensitive: boolean,
): Range[] {
	if (!query) return [];

	const normalizedQuery = caseSensitive ? query : query.toLowerCase();
	const ranges: Range[] = [];
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

	for (
		let node = walker.nextNode() as Text | null;
		node !== null;
		node = walker.nextNode() as Text | null
	) {
		const text = caseSensitive
			? node.textContent
			: node.textContent?.toLowerCase();
		if (!text) continue;

		let startIdx = 0;
		while (startIdx < text.length) {
			const idx = text.indexOf(normalizedQuery, startIdx);
			if (idx === -1) break;

			const range = new Range();
			range.setStart(node, idx);
			range.setEnd(node, idx + query.length);
			ranges.push(range);
			startIdx = idx + 1;
		}
	}

	return ranges;
}
