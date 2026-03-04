import type { RefObject } from "react";
import { useEffect } from "react";
import { useAppHotkey } from "renderer/stores/hotkeys";
import { useTextSearch } from "../../../../hooks/useTextSearch";

interface UseChatMessageSearchOptions {
	containerRef: RefObject<HTMLDivElement | null>;
	isFocused: boolean;
}

interface UseChatMessageSearchReturn {
	isSearchOpen: boolean;
	query: string;
	caseSensitive: boolean;
	matchCount: number;
	activeMatchIndex: number;
	setQuery: (query: string) => void;
	setCaseSensitive: (caseSensitive: boolean) => void;
	findNext: () => void;
	findPrevious: () => void;
	closeSearch: () => void;
}

export function useChatMessageSearch({
	containerRef,
	isFocused,
}: UseChatMessageSearchOptions): UseChatMessageSearchReturn {
	const search = useTextSearch({
		containerRef,
		highlightKeys: {
			matches: "chat-search-matches",
			active: "chat-search-active",
		},
	});

	// Close search when the chat pane loses focus
	useEffect(() => {
		if (!isFocused && search.isSearchOpen) {
			search.closeSearch();
		}
	}, [isFocused, search.isSearchOpen, search.closeSearch]);

	useAppHotkey(
		"FIND_IN_CHAT",
		() => {
			if (search.isSearchOpen) {
				search.closeSearch();
			} else {
				search.openSearch();
			}
		},
		{ enabled: isFocused, preventDefault: true },
		[isFocused, search.isSearchOpen, search.openSearch, search.closeSearch],
	);

	return {
		isSearchOpen: search.isSearchOpen,
		query: search.query,
		caseSensitive: search.caseSensitive,
		matchCount: search.matchCount,
		activeMatchIndex: search.activeMatchIndex,
		setQuery: search.setQuery,
		setCaseSensitive: search.setCaseSensitive,
		findNext: search.findNext,
		findPrevious: search.findPrevious,
		closeSearch: search.closeSearch,
	};
}
