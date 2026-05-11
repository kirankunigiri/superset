# Review Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag-select lines in the diff viewer, write a review comment in a floating composer, and insert formatted text into a terminal pane without hitting Enter -- so they can stack multiple questions and send them all at once.

**Architecture:** Pierre's `MultiFileDiff` already exposes `enableLineSelection` / `onLineSelectionEnd` via `FileDiffOptions` and accepts a `selectedLines` prop for rendering the highlight. A new `useReviewCommentSelection` hook manages the selection state per `WorkspaceDiff` instance. On selection, a `ReviewComposer` popover appears anchored to the diff wrapper. The composer contains a textarea and a terminal-pane dropdown (filtered to agent terminals via `useV2AgentBindingStore`). On "Insert", the formatted text is written to the chosen terminal via `terminalRuntimeRegistry.writeInput` with no trailing newline.

**Tech Stack:** React, `@pierre/diffs/react` (`enableLineSelection`, `SelectedLineRange`), `@superset/ui` (Popover, Select, Textarea, Button), zustand (`useV2AgentBindingStore`), `terminalRuntimeRegistry`, `v2-pane-store-registry`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `.../DiffPane/hooks/useReviewCommentSelection/useReviewCommentSelection.ts` | Create | Selection state machine: range, resolved code text, anchor position |
| `.../DiffPane/hooks/useReviewCommentSelection/index.ts` | Create | Barrel export |
| `.../DiffPane/components/ReviewComposer/ReviewComposer.tsx` | Create | Floating composer UI: textarea + terminal picker + Insert button |
| `.../DiffPane/components/ReviewComposer/index.ts` | Create | Barrel export |
| `.../DiffPane/hooks/useTerminalPaneTargets/useTerminalPaneTargets.ts` | Create | Enumerates terminal panes, filters to agent-bound ones, exposes dropdown options |
| `.../DiffPane/hooks/useTerminalPaneTargets/index.ts` | Create | Barrel export |
| `.../DiffPane/components/WorkspaceDiff/WorkspaceDiff.tsx` | Modify | Wire `enableLineSelection`, `onLineSelectionEnd`, `selectedLines`, render `ReviewComposer` |

All paths relative to `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/`.

## Existing Infrastructure

- **`MultiFileDiff`** -- accepts `selectedLines?: SelectedLineRange | null` for rendering highlighted gutter lines. `FileDiffOptions` (the `options` prop) accepts `enableLineSelection: boolean`, `onLineSelectionEnd: (range: SelectedLineRange | null) => void`, and `onLineSelectionChange` / `onLineSelectionStart`. `SelectedLineRange` is `{ start: number; side?: SelectionSide; end: number; endSide?: SelectionSide }` where `SelectionSide = "deletions" | "additions"`.
- **`terminalRuntimeRegistry.writeInput(terminalId, data)`** -- sends raw bytes to the terminal WebSocket transport, bypassing xterm. Does not add a newline.
- **`getV2PaneStore(workspaceId)`** -- returns the zustand `StoreApi<WorkspaceStore<PaneViewerData>>` for a workspace. `store.getState().tabs[].panes` is `Record<string, Pane<PaneViewerData>>` where terminal panes have `kind === "terminal"` and `data` is `TerminalPaneData` with `{ terminalId }`.
- **`useV2AgentBindingStore`** -- zustand store with `byTerminalId: Record<string, V2AgentBinding>`. A terminal is agent-bound when its `terminalId` exists in this map. `V2AgentBinding` has `identity: AgentIdentity` with `agentId`, `sessionId`, etc.
- **`BUILTIN_AGENT_LABELS`** -- `Record<BuiltinAgentId, string>` mapping agent IDs to display names ("Claude Code", "Codex", etc.).
- **Diff data access** -- `WorkspaceDiff` already has `diffQuery.data` containing `{ oldFile, newFile }` (both `FileContents` with `name` and `contents`). The `newFile.contents` can be split by newline to extract selected code by line number.

---

### Task 1: useReviewCommentSelection hook

**Files:**
- Create: `.../DiffPane/hooks/useReviewCommentSelection/useReviewCommentSelection.ts`
- Create: `.../DiffPane/hooks/useReviewCommentSelection/index.ts`

- [ ] **Step 1: Create the selection state hook**

```ts
// useReviewCommentSelection.ts
import type { SelectedLineRange } from "@pierre/diffs/react";
import { useCallback, useState } from "react";

export interface ReviewSelection {
  /** The raw Pierre range (1-based line numbers). */
  range: SelectedLineRange;
  /** The resolved source lines joined by newline. */
  code: string;
  /** 1-based start/end (inclusive) for display. */
  startLine: number;
  endLine: number;
}

interface UseReviewCommentSelectionOptions {
  /** Full file contents (newFile.contents from diffQuery) used to
   *  extract the selected lines. Falls back to empty when unavailable. */
  fileContents: string | undefined;
}

export function useReviewCommentSelection({
  fileContents,
}: UseReviewCommentSelectionOptions) {
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  // Pierre's SelectedLineRange uses 1-based line numbers.
  // `side` tells us additions vs deletions column; we always read from
  // the "additions" (new file) side -- old-file selections make less
  // sense for review comments since that code no longer exists.

  const onLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      if (!range || !fileContents) {
        setSelection(null);
        return;
      }
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      const lines = fileContents.split("\n");
      // Clamp to file bounds (1-based → 0-based slice).
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
    /** Pierre's SelectedLineRange to pass as selectedLines prop. */
    selectedLines: selection?.range ?? null,
    onLineSelectionEnd,
    clearSelection,
  };
}
```

- [ ] **Step 2: Create barrel export**

```ts
// index.ts
export {
  useReviewCommentSelection,
  type ReviewSelection,
} from "./useReviewCommentSelection";
```

---

### Task 2: useTerminalPaneTargets hook

**Files:**
- Create: `.../DiffPane/hooks/useTerminalPaneTargets/useTerminalPaneTargets.ts`
- Create: `.../DiffPane/hooks/useTerminalPaneTargets/index.ts`

- [ ] **Step 1: Create the terminal targets hook**

```ts
// useTerminalPaneTargets.ts
import { useMemo } from "react";
import { useStore } from "zustand";
import { BUILTIN_AGENT_LABELS } from "@superset/shared/agent-catalog";
import { getV2PaneStore } from "renderer/lib/v2-pane-store-registry";
import { useV2AgentBindingStore } from "renderer/stores/v2-agent-bindings";
import type { TerminalPaneData } from "../../../../../../types";

export interface TerminalTarget {
  terminalId: string;
  paneId: string;
  label: string;
  isAgent: boolean;
}

export function useTerminalPaneTargets(workspaceId: string): {
  targets: TerminalTarget[];
  agentTargets: TerminalTarget[];
} {
  const store = getV2PaneStore(workspaceId);
  // Subscribe to agent bindings so the list re-renders when an agent starts/stops.
  const agentBindings = useV2AgentBindingStore((s) => s.byTerminalId);

  return useMemo(() => {
    if (!store) return { targets: [], agentTargets: [] };

    const state = store.getState();
    const all: TerminalTarget[] = [];

    for (const tab of state.tabs) {
      for (const pane of Object.values(tab.panes)) {
        if (pane.kind !== "terminal") continue;
        const terminalId = (pane.data as TerminalPaneData).terminalId;
        const binding = agentBindings[terminalId];
        const isAgent = !!binding;
        const agentLabel = binding
          ? (BUILTIN_AGENT_LABELS[
              binding.identity.agentId as keyof typeof BUILTIN_AGENT_LABELS
            ] ?? binding.identity.agentId)
          : null;

        all.push({
          terminalId,
          paneId: pane.id,
          label: agentLabel ?? pane.titleOverride ?? "Terminal",
          isAgent,
        });
      }
    }

    // Sort: agents first, then by label.
    all.sort((a, b) => {
      if (a.isAgent !== b.isAgent) return a.isAgent ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    return {
      targets: all,
      agentTargets: all.filter((t) => t.isAgent),
    };
  }, [store, agentBindings]);
}
```

- [ ] **Step 2: Create barrel export**

```ts
// index.ts
export {
  useTerminalPaneTargets,
  type TerminalTarget,
} from "./useTerminalPaneTargets";
```

---

### Task 3: ReviewComposer component

**Files:**
- Create: `.../DiffPane/components/ReviewComposer/ReviewComposer.tsx`
- Create: `.../DiffPane/components/ReviewComposer/index.ts`

- [ ] **Step 1: Create ReviewComposer UI**

```tsx
// ReviewComposer.tsx
import { Button } from "@superset/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@superset/ui/select";
import { Textarea } from "@superset/ui/textarea";
import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuSend, LuX } from "react-icons/lu";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import type { ReviewSelection } from "../../hooks/useReviewCommentSelection";
import {
  type TerminalTarget,
  useTerminalPaneTargets,
} from "../../hooks/useTerminalPaneTargets";

interface ReviewComposerProps {
  workspaceId: string;
  /** File path relative to repo root. */
  filePath: string;
  selection: ReviewSelection;
  onClose: () => void;
}

/**
 * Format the text that will be inserted into the terminal.
 * Does NOT append a trailing newline so the user can stack
 * multiple comments and hit Enter once.
 */
function formatInsertText(
  filePath: string,
  selection: ReviewSelection,
  comment: string,
  isStacked: boolean,
): string {
  const header = `Review comment for ${filePath}:${selection.startLine}-${selection.endLine}`;
  // Guess language from file extension for the fenced code block.
  const ext = filePath.split(".").pop() ?? "";
  const body = [
    header,
    "",
    "```" + ext,
    selection.code,
    "```",
    "",
    comment,
  ].join("\n");

  return isStacked ? `\n\n---\n${body}` : body;
}

/** Track whether a given terminal already received a review comment
 *  in this session so we can prepend the stacking separator. */
const insertedTerminals = new Set<string>();

export function ReviewComposer({
  workspaceId,
  filePath,
  selection,
  onClose,
}: ReviewComposerProps) {
  const { targets, agentTargets } = useTerminalPaneTargets(workspaceId);
  const displayTargets = agentTargets.length > 0 ? agentTargets : targets;

  const [selectedTerminalId, setSelectedTerminalId] = useState<string>("");
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Default to first available target.
  useEffect(() => {
    if (!selectedTerminalId && displayTargets.length > 0) {
      setSelectedTerminalId(displayTargets[0].terminalId);
    }
  }, [displayTargets, selectedTerminalId]);

  // Auto-focus textarea on mount.
  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleInsert = useCallback(() => {
    if (!comment.trim() || !selectedTerminalId) return;
    const isStacked = insertedTerminals.has(selectedTerminalId);
    const text = formatInsertText(filePath, selection, comment.trim(), isStacked);
    terminalRuntimeRegistry.writeInput(selectedTerminalId, text);
    insertedTerminals.add(selectedTerminalId);
    onClose();
  }, [comment, selectedTerminalId, filePath, selection, onClose]);

  // Ctrl/Cmd+Enter to insert.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleInsert();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [handleInsert, onClose],
  );

  if (displayTargets.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-lg">
        <p className="text-xs text-muted-foreground">
          No terminal panes open. Open a terminal first.
        </p>
        <Button type="button" size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex w-80 flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-lg"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          Review comment{" "}
          <span className="text-muted-foreground">
            L{selection.startLine}
            {selection.endLine !== selection.startLine &&
              `-${selection.endLine}`}
          </span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <LuX className="size-3.5" />
        </button>
      </div>

      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Write your question or comment..."
        className="min-h-[72px] resize-y text-xs"
        rows={3}
      />

      {/* Terminal picker + Insert */}
      <div className="flex items-center gap-2">
        <Select
          value={selectedTerminalId}
          onValueChange={setSelectedTerminalId}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue placeholder="Select terminal" />
          </SelectTrigger>
          <SelectContent>
            {displayTargets.map((t) => (
              <SelectItem key={t.terminalId} value={t.terminalId}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="xs"
          disabled={!comment.trim()}
          onClick={handleInsert}
          title="Insert into terminal (Cmd+Enter)"
        >
          <LuSend className="mr-1 size-3" />
          Insert
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Text is inserted without Enter — stack multiple, then send.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create barrel export**

```ts
// index.ts
export { ReviewComposer } from "./ReviewComposer";
```

---

### Task 4: Wire selection + composer into WorkspaceDiff

**Files:**
- Modify: `.../DiffPane/components/WorkspaceDiff/WorkspaceDiff.tsx`

This is the integration step. `WorkspaceDiff` already renders `<MultiFileDiff>` and has access to `diffQuery.data` (the file contents) and `path` (file path). We add three things:

1. Call `useReviewCommentSelection` with `newFile.contents`.
2. Pass `enableLineSelection`, `onLineSelectionEnd`, and `selectedLines` into `MultiFileDiff` options/props.
3. Render `<ReviewComposer>` in a positioned wrapper when a selection exists.

- [ ] **Step 1: Add imports**

Add these imports at the top of `WorkspaceDiff.tsx`:

```ts
import { useReviewCommentSelection } from "../../hooks/useReviewCommentSelection";
import { ReviewComposer } from "../ReviewComposer";
```

- [ ] **Step 2: Add the selection hook call inside the component body**

After the existing `useDiffAnnotations` call (line 113), add:

```ts
const reviewComment = useReviewCommentSelection({
  fileContents: diffQuery.data?.newFile.contents,
});
```

- [ ] **Step 3: Pass selection options to MultiFileDiff**

Update the `<MultiFileDiff>` JSX. Add `selectedLines` prop and add `enableLineSelection` / `onLineSelectionEnd` into the `options` object:

Change the `<MultiFileDiff>` call (currently lines 151-189) so that:

```tsx
<MultiFileDiff<DiffCommentThread>
  oldFile={diffQuery.data.oldFile}
  newFile={diffQuery.data.newFile}
  style={themeVars}
  lineAnnotations={lineAnnotations}
  selectedLines={reviewComment.selectedLines}
  renderAnnotation={renderAnnotation}
  options={{
    diffStyle,
    expandUnchanged,
    overflow: "wrap",
    collapsed,
    disableFileHeader: true,
    theme: shikiTheme,
    themeType: activeTheme.type,
    enableLineSelection: true,
    onLineSelectionEnd: reviewComment.onLineSelectionEnd,
    unsafeCSS: `...existing CSS...`,
  }}
/>
```

The key additions vs the existing code are:
- `selectedLines={reviewComment.selectedLines}` on the component props
- `enableLineSelection: true` in the options object
- `onLineSelectionEnd: reviewComment.onLineSelectionEnd` in the options object

- [ ] **Step 4: Render ReviewComposer below the diff**

Wrap the existing `<div className="flex flex-col">` return in a fragment or parent `div` with `position: relative`, then render the composer as an absolutely-positioned overlay anchored to the bottom-right of the diff:

Replace the return block (lines 133-192) with:

```tsx
return (
  <div className="relative flex flex-col">
    <DiffFileHeader
      {/* ... existing props unchanged ... */}
    />
    {diffQuery.data ? (
      <MultiFileDiff<DiffCommentThread>
        {/* ... updated as described in Step 3 ... */}
      />
    ) : null}
    {reviewComment.selection && (
      <div className="sticky bottom-2 z-50 flex justify-end px-2">
        <ReviewComposer
          workspaceId={workspaceId}
          filePath={path}
          selection={reviewComment.selection}
          onClose={reviewComment.clearSelection}
        />
      </div>
    )}
  </div>
);
```

Using `sticky bottom-2` keeps the composer pinned near the bottom of the visible area within the virtualizer scroll container, so it stays accessible even in long diffs.

---

### Task 5: Verify + polish

- [ ] **Step 1: Manual testing checklist**

1. Open a workspace with changes. The diff pane should render as before (no visual regression).
2. Click and drag across line numbers (or line content) in a diff file -- a blue/purple selection highlight should appear on the gutter via Pierre's built-in selection rendering.
3. On mouse release, the `ReviewComposer` should appear as a sticky card near the bottom-right of that diff file.
4. The terminal dropdown should list agent terminals first (if any are running). If no agents, show all terminal panes.
5. Type a comment, press Cmd+Enter (or click Insert). The formatted text should appear in the selected terminal.
6. The text should NOT have a trailing newline -- the cursor should sit at the end of the comment, not on a new line.
7. Select lines in a second file and insert another comment to the same terminal -- verify the `\n\n---\n` separator is prepended.
8. Press Escape or the X button to dismiss the composer -- the selection highlight should clear.
9. Collapsed and deferred diffs should be unaffected.

- [ ] **Step 2: Edge cases to handle**

- If `diffQuery.data` is still loading (null), selection is disabled because `fileContents` is undefined and `MultiFileDiff` won't render.
- If the user selects from the "deletions" side, the code will be extracted from the new file contents using just the line numbers. This is intentional -- the old-file text is less useful for asking questions about current code.
- The `insertedTerminals` Set that tracks stacking resets on page reload, which is acceptable since terminal sessions also reset.
- If zero terminal panes exist, the composer shows a "No terminal panes open" message instead of a broken dropdown.

- [ ] **Step 3: Run lint and typecheck**

```bash
bun run lint:fix
bun run typecheck
```
