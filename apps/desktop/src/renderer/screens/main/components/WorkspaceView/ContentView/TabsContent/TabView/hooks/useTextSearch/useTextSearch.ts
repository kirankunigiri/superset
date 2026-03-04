import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { collectSearchRanges } from "./collectSearchRanges";

interface UseTextSearchOptions {
	containerRef: RefObject<HTMLDivElement | null>;
	/** CSS Custom Highlight names used to paint matches and the active match. */
	highlightKeys: { matches: string; active: string };
}

export interface UseTextSearchReturn {
	isSearchOpen: boolean;
	query: string;
	caseSensitive: boolean;
	matchCount: number;
	activeMatchIndex: number;
	setQuery: (query: string) => void;
	setCaseSensitive: (caseSensitive: boolean) => void;
	findNext: () => void;
	findPrevious: () => void;
	openSearch: () => void;
	closeSearch: () => void;
}

/**
 * Core text-search hook shared by all pane types.
 *
 * Handles:
 * - DOM TreeWalker traversal + Range collection (via collectSearchRanges)
 * - CSS Custom Highlight registration / cleanup
 * - Active-match navigation (findNext / findPrevious)
 * - 150 ms debounce on DOM traversal
 * - Highlight cleanup on unmount
 *
 * Callers are responsible for pane-specific lifecycle (close on focus loss,
 * reset on file change, hotkey binding).
 */
export function useTextSearch({
	containerRef,
	highlightKeys,
}: UseTextSearchOptions): UseTextSearchReturn {
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [matchCount, setMatchCount] = useState(0);
	const [activeMatchIndex, setActiveMatchIndex] = useState(0);

	const rangesRef = useRef<Range[]>([]);
	const activeMatchIndexRef = useRef(0);
	activeMatchIndexRef.current = activeMatchIndex;
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// CSS.highlights is a global singleton — callers should supply unique keys
	// per pane type to avoid cross-pane clobbering.
	const clearHighlights = useCallback(() => {
		if (rangesRef.current.length === 0) return;
		if (typeof CSS !== "undefined" && CSS.highlights) {
			CSS.highlights.delete(highlightKeys.matches);
			CSS.highlights.delete(highlightKeys.active);
		}
		rangesRef.current = [];
	}, [highlightKeys.matches, highlightKeys.active]);

	const scrollRangeIntoView = useCallback((range: Range) => {
		range.startContainer.parentElement?.scrollIntoView({
			behavior: "smooth",
			block: "center",
		});
	}, []);

	const performSearch = useCallback(
		(searchQuery: string, isCaseSensitive: boolean) => {
			clearHighlights();

			const container = containerRef.current;
			if (!container || !searchQuery) {
				setMatchCount(0);
				setActiveMatchIndex(0);
				return;
			}

			const ranges = collectSearchRanges(
				container,
				searchQuery,
				isCaseSensitive,
			);
			rangesRef.current = ranges;
			setMatchCount(ranges.length);

			if (ranges.length > 0 && typeof CSS !== "undefined" && CSS.highlights) {
				const allHighlight = new Highlight();
				for (const r of ranges) allHighlight.add(r);
				CSS.highlights.set(highlightKeys.matches, allHighlight);

				setActiveMatchIndex(0);
				const activeHighlight = new Highlight(ranges[0]);
				CSS.highlights.set(highlightKeys.active, activeHighlight);
				scrollRangeIntoView(ranges[0]);
			} else {
				setActiveMatchIndex(0);
			}
		},
		[
			containerRef,
			clearHighlights,
			scrollRangeIntoView,
			highlightKeys.matches,
			highlightKeys.active,
		],
	);

	const setActiveMatch = useCallback(
		(index: number) => {
			const ranges = rangesRef.current;
			if (ranges.length === 0) return;

			setActiveMatchIndex(index);

			if (typeof CSS !== "undefined" && CSS.highlights) {
				CSS.highlights.delete(highlightKeys.active);
				const activeHighlight = new Highlight(ranges[index]);
				CSS.highlights.set(highlightKeys.active, activeHighlight);
			}

			scrollRangeIntoView(ranges[index]);
		},
		[scrollRangeIntoView, highlightKeys.active],
	);

	const findNext = useCallback(() => {
		if (rangesRef.current.length === 0) return;
		const nextIndex =
			(activeMatchIndexRef.current + 1) % rangesRef.current.length;
		setActiveMatch(nextIndex);
	}, [setActiveMatch]);

	const findPrevious = useCallback(() => {
		if (rangesRef.current.length === 0) return;
		const prevIndex =
			(activeMatchIndexRef.current - 1 + rangesRef.current.length) %
			rangesRef.current.length;
		setActiveMatch(prevIndex);
	}, [setActiveMatch]);

	const openSearch = useCallback(() => {
		setIsSearchOpen(true);
	}, []);

	const closeSearch = useCallback(() => {
		if (searchTimerRef.current) {
			clearTimeout(searchTimerRef.current);
			searchTimerRef.current = null;
		}
		setIsSearchOpen(false);
		setQuery("");
		setMatchCount(0);
		setActiveMatchIndex(0);
		clearHighlights();
	}, [clearHighlights]);

	// Debounce the DOM walk so we don't re-traverse on every keystroke
	useEffect(() => {
		if (!isSearchOpen) return;

		if (searchTimerRef.current) {
			clearTimeout(searchTimerRef.current);
		}

		searchTimerRef.current = setTimeout(() => {
			performSearch(query, caseSensitive);
		}, 150);

		return () => {
			if (searchTimerRef.current) {
				clearTimeout(searchTimerRef.current);
			}
		};
	}, [query, caseSensitive, isSearchOpen, performSearch]);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			clearHighlights();
			if (searchTimerRef.current) {
				clearTimeout(searchTimerRef.current);
			}
		};
	}, [clearHighlights]);

	return {
		isSearchOpen,
		query,
		caseSensitive,
		matchCount,
		activeMatchIndex,
		setQuery,
		setCaseSensitive,
		findNext,
		findPrevious,
		openSearch,
		closeSearch,
	};
}
