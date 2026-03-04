import { beforeEach, describe, expect, test } from "bun:test";
import { collectSearchRanges } from "./collectSearchRanges";

// ---------------------------------------------------------------------------
// Minimal DOM stubs
//
// Bun's test environment has no browser DOM. We supply just enough of the
// TreeWalker / Range / Text API surface that collectSearchRanges needs.
// ---------------------------------------------------------------------------

interface FakeText {
	nodeType: number;
	textContent: string;
	parentElement: null;
}

function makeTextNode(text: string): FakeText {
	return { nodeType: 3, textContent: text, parentElement: null };
}

interface FakeRange {
	startContainer: FakeText | null;
	startOffset: number;
	endContainer: FakeText | null;
	endOffset: number;
}

function _makeFakeRange(): FakeRange {
	return {
		startContainer: null,
		startOffset: 0,
		endContainer: null,
		endOffset: 0,
	};
}

function installDomStubs(textNodes: FakeText[]) {
	let idx = -1;

	// biome-ignore lint/suspicious/noExplicitAny: DOM stub
	(globalThis as any).NodeFilter = { SHOW_TEXT: 4 };

	// biome-ignore lint/suspicious/noExplicitAny: DOM stub
	(globalThis as any).document = {
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		...(globalThis as any).document,
		createTreeWalker: (_root: unknown, _whatToShow: unknown) => ({
			nextNode: () => {
				idx += 1;
				return idx < textNodes.length ? textNodes[idx] : null;
			},
		}),
	};

	// biome-ignore lint/suspicious/noExplicitAny: DOM stub
	(globalThis as any).Range = class {
		startContainer: FakeText | null = null;
		startOffset = 0;
		endContainer: FakeText | null = null;
		endOffset = 0;

		setStart(node: FakeText, offset: number) {
			this.startContainer = node;
			this.startOffset = offset;
		}
		setEnd(node: FakeText, offset: number) {
			this.endContainer = node;
			this.endOffset = offset;
		}
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("collectSearchRanges", () => {
	beforeEach(() => {
		// Reset the walker index by re-installing stubs for each test
	});

	test("returns empty array when query is empty", () => {
		installDomStubs([makeTextNode("hello world")]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		const ranges = collectSearchRanges(container, "", false);
		expect(ranges).toHaveLength(0);
	});

	test("finds a single match (case-insensitive)", () => {
		const node = makeTextNode("Hello World");
		installDomStubs([node]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		const ranges = collectSearchRanges(container, "world", false);
		expect(ranges).toHaveLength(1);
		expect((ranges[0] as unknown as FakeRange).startOffset).toBe(6);
		expect((ranges[0] as unknown as FakeRange).endOffset).toBe(11);
	});

	test("finds a single match (case-sensitive)", () => {
		const node = makeTextNode("Hello World");
		installDomStubs([node]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		// case-sensitive: "world" should NOT match "World"
		const ranges = collectSearchRanges(container, "world", true);
		expect(ranges).toHaveLength(0);
	});

	test("case-sensitive match finds exact case", () => {
		const node = makeTextNode("Hello World");
		installDomStubs([node]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		const ranges = collectSearchRanges(container, "World", true);
		expect(ranges).toHaveLength(1);
		expect((ranges[0] as unknown as FakeRange).startOffset).toBe(6);
	});

	test("finds multiple non-overlapping matches in one text node", () => {
		const node = makeTextNode("ab ab ab");
		installDomStubs([node]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		const ranges = collectSearchRanges(container, "ab", false);
		expect(ranges).toHaveLength(3);
		expect((ranges[0] as unknown as FakeRange).startOffset).toBe(0);
		expect((ranges[1] as unknown as FakeRange).startOffset).toBe(3);
		expect((ranges[2] as unknown as FakeRange).startOffset).toBe(6);
	});

	test("finds matches across multiple text nodes", () => {
		const node1 = makeTextNode("foo bar");
		const node2 = makeTextNode("baz foo");
		installDomStubs([node1, node2]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		const ranges = collectSearchRanges(container, "foo", false);
		expect(ranges).toHaveLength(2);
		expect((ranges[0] as unknown as FakeRange).startContainer).toBe(node1);
		expect((ranges[1] as unknown as FakeRange).startContainer).toBe(node2);
	});

	test("returns empty array when no matches exist", () => {
		installDomStubs([makeTextNode("hello world")]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		const ranges = collectSearchRanges(container, "xyz", false);
		expect(ranges).toHaveLength(0);
	});

	test("range end offset equals start offset plus query length", () => {
		const node = makeTextNode("abcdef");
		installDomStubs([node]);
		// biome-ignore lint/suspicious/noExplicitAny: DOM stub
		const container = {} as any;
		const ranges = collectSearchRanges(container, "bcd", false);
		expect(ranges).toHaveLength(1);
		const r = ranges[0] as unknown as FakeRange;
		expect(r.startOffset).toBe(1);
		expect(r.endOffset).toBe(4); // 1 + "bcd".length
	});
});
