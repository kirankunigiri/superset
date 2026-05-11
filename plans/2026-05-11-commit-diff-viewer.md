# Commit-Based Diff Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline commit list to the changes sidebar with keyboard-navigable commit and file selection.

**Architecture:** Replace the dropdown-only commit filter with an inline commit list above the file list. A toggle switches between "All" (current behavior) and "Commits" view. In commits view, a compact scrollable commit list appears with keyboard navigation. Selecting a commit filters the file list to that commit's changes. File list also gets keyboard navigation.

**Tech Stack:** React, zustand (via `@superset/panes` store patterns), existing `workspaceTrpc` git APIs (`listCommits`, `getCommitFiles`), existing `ChangesFilter` persistence.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `.../useChangesTab/components/CommitList/CommitList.tsx` | Create | Inline scrollable commit list with keyboard nav |
| `.../useChangesTab/components/CommitList/index.ts` | Create | Barrel export |
| `.../useChangesTab/components/ChangesTabContent/ChangesTabContent.tsx` | Modify | Add toggle + commit list above file list |
| `.../useChangesTab/components/ChangesFileList/ChangesFileList.tsx` | Modify | Add keyboard navigation for files |
| `.../useChangesTab/components/ChangesFileList/components/FileRow/FileRow.tsx` | Modify | Add `isSelected` visual state + `data-index` |
| `.../useChangesTab/useChangesTab.tsx` | Modify | Wire up state for view mode toggle |

All paths relative to `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/hooks/`.

## Existing Infrastructure

- **`ChangesFilter`** — already supports `{ kind: "all" }`, `{ kind: "uncommitted" }`, `{ kind: "commit", hash }`, `{ kind: "range", fromHash, toHash }`. Persisted in `v2WorkspaceLocalState.sidebarState.changesFilter`.
- **`workspaceTrpc.git.listCommits`** — returns `{ commits: Commit[] }` for commits between base branch and HEAD.
- **`workspaceTrpc.git.getCommitFiles`** — returns `{ files }` for a specific commit hash.
- **`CommitRow`** — existing component at `.../CommitFilterDropdown/components/CommitRow/CommitRow.tsx`, renders commit message + metadata. Reuse this.
- **`CommitFilterDropdown`** — existing dropdown with commit selection. Keep it but it becomes secondary to the inline list.

---

### Task 1: CommitList Component

**Files:**
- Create: `.../useChangesTab/components/CommitList/CommitList.tsx`
- Create: `.../useChangesTab/components/CommitList/index.ts`

- [ ] **Step 1: Create CommitList component**

```tsx
// CommitList.tsx
// Compact scrollable list of commits with keyboard navigation.
// First item is always "Active changes" (uncommitted).
// Selecting a commit calls onFilterChange({ kind: "commit", hash }).
// Selecting "Active changes" calls onFilterChange({ kind: "uncommitted" }).
// Up/Down arrow keys navigate the list.
// Max height shows ~5-6 items, scrolls for more.

import { cn } from "@superset/ui/utils";
import { GitCommitHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  // Index 0 = active changes, 1..N = commits
  const selectedIndex = filter.kind === "commit"
    ? commits.findIndex((c) => c.hash === filter.hash) + 1
    : 0;
  const [focusIndex, setFocusIndex] = useState(selectedIndex);
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
        const next = Math.min(focusIndex + 1, itemCount - 1);
        setFocusIndex(next);
        selectItem(next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(focusIndex - 1, 0);
        setFocusIndex(prev);
        selectItem(prev);
      }
    },
    [focusIndex, itemCount, selectItem],
  );

  // Scroll focused item into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const item = container.querySelector(`[data-index="${focusIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  // Sync focusIndex when filter changes externally
  useEffect(() => {
    setFocusIndex(selectedIndex);
  }, [selectedIndex]);

  return (
    <div
      ref={containerRef}
      // biome-ignore lint: keyboard handler on scrollable container
      role="listbox"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="max-h-[180px] overflow-y-auto border-b border-border focus:outline-none"
    >
      {/* Active changes item */}
      <button
        type="button"
        data-index={0}
        onClick={() => { setFocusIndex(0); selectItem(0); }}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
          "hover:bg-accent",
          selectedIndex === 0 && "bg-accent/60 font-medium",
          focusIndex === 0 && "ring-1 ring-inset ring-ring",
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

      {/* Commit items */}
      {commits.map((commit, i) => {
        const index = i + 1;
        return (
          <button
            type="button"
            key={commit.hash}
            data-index={index}
            onClick={() => { setFocusIndex(index); selectItem(index); }}
            className={cn(
              "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs",
              "hover:bg-accent",
              selectedIndex === index && "bg-accent/60 font-medium",
              focusIndex === index && "ring-1 ring-inset ring-ring",
            )}
          >
            <GitCommitHorizontal className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate">{commit.message}</div>
              <div className="text-[10px] text-muted-foreground">
                {commit.shortHash} · {commit.author}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create barrel export**

```tsx
// index.ts
export { CommitList } from "./CommitList";
```

- [ ] **Step 3: Verify it compiles**

Run: `bun run --filter @superset/desktop typecheck`

---

### Task 2: Add View Mode Toggle to ChangesTabContent

**Files:**
- Modify: `.../useChangesTab/components/ChangesTabContent/ChangesTabContent.tsx`

- [ ] **Step 1: Add toggle and commit list**

Add a "All | Commits" toggle above the file list. When "Commits" is selected, show the `CommitList` component above the file list. When a commit is selected, the file list shows only that commit's changes (already handled by `ChangesFilter`).

The toggle state should derive from the current `ChangesFilter`:
- `filter.kind === "all"` → "All" tab active
- `filter.kind === "commit"` or `"uncommitted"` → "Commits" tab active

When clicking "All" → `onFilterChange({ kind: "all" })`.
When clicking "Commits" → `onFilterChange({ kind: "uncommitted" })` (shows active changes by default).

```tsx
// Add to ChangesTabContent, between ChangesHeader and the file list:

const isCommitView = filter.kind === "commit" || filter.kind === "uncommitted";

// Toggle bar
<div className="flex border-b border-border">
  <button
    type="button"
    onClick={() => onFilterChange({ kind: "all" })}
    className={cn(
      "flex-1 py-1.5 text-xs font-medium transition-colors",
      !isCommitView ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground hover:text-foreground",
    )}
  >
    All
  </button>
  <button
    type="button"
    onClick={() => onFilterChange({ kind: "uncommitted" })}
    className={cn(
      "flex-1 py-1.5 text-xs font-medium transition-colors",
      isCommitView ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground hover:text-foreground",
    )}
  >
    Commits
  </button>
</div>

{/* Show commit list only in commit view */}
{isCommitView && (
  <CommitList
    commits={commits.data?.commits ?? []}
    filter={filter}
    onFilterChange={onFilterChange}
    uncommittedCount={uncommittedCount}
  />
)}
```

- [ ] **Step 2: Pass `uncommittedCount` through props**

Already available in `ChangesTabContentProps` via `status.data.staged.length + status.data.unstaged.length`. It's already passed from `useChangesTab.tsx` as the `uncommittedCount` prop to `ChangesHeader`. Pass it to `ChangesTabContent` (already there).

- [ ] **Step 3: Verify it compiles and renders**

Run: `bun run --filter @superset/desktop typecheck && bun run lint`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(desktop): add commit list with toggle to changes sidebar"
```

---

### Task 3: File List Keyboard Navigation

**Files:**
- Modify: `.../useChangesTab/components/ChangesFileList/ChangesFileList.tsx`
- Modify: `.../useChangesTab/components/ChangesFileList/components/FileRow/FileRow.tsx`

- [ ] **Step 1: Add keyboard navigation to ChangesFileList**

Track a `selectedIndex` state. On `ArrowDown`/`ArrowUp`, increment/decrement the index and call `onSelectFile` for the file at that index. The component needs a flat list of all visible files (across groups) for indexing.

```tsx
// In ChangesFileList, add:
const [selectedIndex, setSelectedIndex] = useState(-1);
const allFiles = useMemo(() => {
  const flat: ChangesetFile[] = [];
  for (const key of GROUP_ORDER) {
    flat.push(...grouped[key]);
  }
  return flat;
}, [grouped]);

const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = Math.min(selectedIndex + 1, allFiles.length - 1);
    setSelectedIndex(next);
    onSelectFile?.(allFiles[next].path);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = Math.max(selectedIndex - 1, 0);
    setSelectedIndex(prev);
    onSelectFile?.(allFiles[prev].path);
  }
}, [selectedIndex, allFiles, onSelectFile]);
```

Wrap the file list `div` with `tabIndex={0}`, `role="listbox"`, and `onKeyDown={handleKeyDown}`.

- [ ] **Step 2: Add `isSelected` prop to FileRow**

Pass `isSelected` based on whether the file's flat index matches `selectedIndex`. Add visual highlighting (same `bg-accent/60` pattern as CommitList).

When `onSelect` is called from a click, also update `selectedIndex` to the clicked file's flat index.

- [ ] **Step 3: Auto-scroll selected file into view**

Use the same `data-index` + `scrollIntoView({ block: "nearest" })` pattern from CommitList.

- [ ] **Step 4: Sync selectedIndex when a file is clicked**

When `FileRow` is clicked, the flat index should be found and `setSelectedIndex` updated.

- [ ] **Step 5: Verify and commit**

Run: `bun run --filter @superset/desktop typecheck && bun run lint`

```bash
git add -A && git commit -m "feat(desktop): add keyboard navigation to file list in changes sidebar"
```

---

### Task 4: Final Integration & Polish

- [ ] **Step 1: Verify full flow**
  - Open a workspace with commits
  - Click "Commits" toggle → commit list appears
  - Click a commit → file list filters to that commit
  - Arrow up/down through commits → file list updates
  - Click "All" toggle → shows all changes (default)
  - Click a file → diff pane opens
  - Arrow up/down through files → diff updates
  - Focus commit list → arrow keys work; focus file list → arrow keys work

- [ ] **Step 2: Run typecheck + lint**

```bash
bun run --filter @superset/desktop typecheck && bun run lint
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(desktop): commit-based diff viewer with keyboard navigation"
```
