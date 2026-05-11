# Diff Viewer Code Review Comments Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let users create draft code-review questions directly from the diff viewer by highlighting code or clicking a hovered line plus button, choosing a terminal agent, and sending the composed prompt into that terminal without pressing Enter.

**Architecture:** Add a renderer-only diff review composer layered over the existing `FileViewerPane` diff view. The feature should reuse existing diff DOM location helpers, existing terminal pane state, and `useTerminalCallbacksStore` paste callbacks so the text is inserted into an agent terminal exactly like a paste, but not submitted. Keep this feature local to the desktop diff/file-viewer path first; do not add GitHub PR comment persistence.

**Tech Stack:** Electron renderer, React, Zustand tab store, `@pierre/diffs/react` rendered DOM, shadcn/ui components from `@superset/ui`, existing terminal callback store.

---

## Current Context

Relevant existing code:

- Diff content is rendered by `LightDiffViewer` at `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ChangesContent/components/LightDiffViewer/LightDiffViewer.tsx`.
- The file-viewer diff mode wraps `LightDiffViewer` inside `FileViewerContent` at `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/FileViewerContent.tsx`.
- Diff DOM metadata is already decoded by `getDiffLocationFromEvent`, `getColumnFromDiffPoint`, and `mapDiffLocationToRawPosition` at `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/utils/diff-location.ts`.
- Diff right-click actions already live in `DiffViewerContextMenu` at `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffViewerContextMenu/DiffViewerContextMenu.tsx`.
- Terminal panes register paste callbacks through `useTerminalCallbacksStore` at `apps/desktop/src/renderer/stores/tabs/terminal-callbacks.ts`.
- Terminal paste currently calls `xterm.paste(text)` and does not append Enter in `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/hooks/useTerminalLifecycle.ts`.
- Agent preset picker exists for automations at `apps/desktop/src/renderer/routes/_authenticated/_dashboard/automations/components/AgentPicker/AgentPicker.tsx`, but this feature needs to choose an existing terminal pane/session, not only an agent preset id.

Important constraints:

- Do not send the terminal message automatically. The final action must insert text only; users manually press Enter.
- Users must be able to stack multiple questions. Therefore each send should append to the chosen terminal in a predictable draft format, not replace prior input.
- Body-level `user-select: none` is already handled in diff views. Do not regress diff text selection.
- Follow `apps/desktop/AGENTS.md`: use existing aliases and tRPC patterns. This plan should not require IPC/tRPC unless the existing renderer terminal paste callbacks cannot cover the use case.

---

## Proposed UX

1. Hover any changed or context line in a diff.
2. A small plus button appears in the diff gutter/line action rail.
3. Clicking plus opens an inline floating composer anchored to that line.
4. Alternatively, selecting text in the diff shows a compact floating action button, or the context menu exposes `Ask Agent About Selection`.
5. The composer shows:
   - selected file path and line/range summary,
   - selected code snippet or clicked line snippet,
   - textarea for the user's question/comment,
   - picker for an open terminal agent pane,
   - `Insert in Terminal` button.
6. Clicking `Insert in Terminal` pastes a formatted prompt into the selected terminal pane without a trailing newline/Enter.
7. If the user sends multiple comments to the same terminal, append a separator before each subsequent prompt so questions can be stacked.

Suggested inserted prompt format:

```text

---
Review question for <relative-or-absolute-file-path>:<startLine>-<endLine>

```<language-if-known>
<selected-or-line-code>
```

<user question>
```

Do not include a trailing newline that causes submission. A leading newline/separator is okay only when appending to an existing terminal draft.

---

## Data Model

Create local renderer types near the feature:

```ts
export interface DiffReviewSelection {
  filePath: string;
  startLine: number;
  endLine: number;
  side: "old" | "new";
  lineType: "add" | "remove" | "context";
  selectedText: string;
  language?: string;
}

export interface TerminalAgentTarget {
  paneId: string;
  tabId: string;
  label: string;
  isFocused: boolean;
  isPasteReady: boolean;
}
```

Use `paneId` as the target because `useTerminalCallbacksStore` is keyed by pane id.

---

## Step-by-Step Plan

### Task 1: Add pure utilities for extracting diff review selections

**Objective:** Convert click/selection events in the diff DOM into a stable `DiffReviewSelection`.

**Files:**
- Create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/utils/diff-review-selection.ts`
- Create test: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/utils/diff-review-selection.test.ts`
- Read/reuse: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/utils/diff-location.ts`

**Implementation notes:**

Add pure helpers first:

```ts
import type { DiffDomLocation } from "./diff-location";
import { mapDiffLocationToRawPosition } from "./diff-location";

export interface DiffReviewSelection {
  filePath: string;
  startLine: number;
  endLine: number;
  side: DiffDomLocation["side"];
  lineType: DiffDomLocation["lineType"];
  selectedText: string;
  language?: string;
}

export function buildLineReviewSelection(input: {
  filePath: string;
  contents: { original: string; modified: string; language?: string };
  location: DiffDomLocation;
}): DiffReviewSelection {
  const position = mapDiffLocationToRawPosition({
    contents: input.contents,
    lineNumber: input.location.lineNumber,
    side: input.location.side,
    lineType: input.location.lineType,
  });
  const source = input.location.side === "old" ? input.contents.original : input.contents.modified;
  const selectedText = source.split("\n")[position.lineNumber - 1] ?? "";

  return {
    filePath: input.filePath,
    startLine: position.lineNumber,
    endLine: position.lineNumber,
    side: input.location.side,
    lineType: input.location.lineType,
    selectedText,
    language: input.contents.language,
  };
}
```

For range selection, start with pragmatic behavior:
- Use `window.getSelection().toString()` for snippet text.
- Use the most recent diff location as the anchor for `startLine` and `endLine` in v1.
- If multiple-line exact DOM mapping is too brittle, keep line range best-effort and prioritize selected text correctness.

**Tests:**
- Single added line maps to modified line number and content.
- Single removed line maps to original line number and content.
- Context line maps to the expected side line.
- Empty/missing line returns an empty selectedText instead of throwing.

**Verification:**

Run:

```bash
bun test apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/utils/diff-review-selection.test.ts
```

Expected: tests pass.

---

### Task 2: Add prompt formatting utilities

**Objective:** Produce a stable terminal draft string with no implicit submit.

**Files:**
- Create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffReviewComposer/utils/formatDiffReviewPrompt.ts`
- Create test: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffReviewComposer/utils/formatDiffReviewPrompt.test.ts`

**Implementation notes:**

Implement:

```ts
import type { DiffReviewSelection } from "../../FileViewerContent/utils/diff-review-selection";

export function formatDiffReviewPrompt(input: {
  selection: DiffReviewSelection;
  question: string;
  appendSeparator?: boolean;
}): string {
  const { selection, question, appendSeparator = true } = input;
  const lineLabel =
    selection.startLine === selection.endLine
      ? `${selection.filePath}:${selection.startLine}`
      : `${selection.filePath}:${selection.startLine}-${selection.endLine}`;
  const language = selection.language ?? "";
  const prefix = appendSeparator ? "\n\n---\n" : "";

  return `${prefix}Review question for ${lineLabel}\n\n\`\`\`${language}\n${selection.selectedText}\n\`\`\`\n\n${question.trim()}`;
}
```

Do not add a trailing `\n` after the question. Do not call terminal write APIs here.

**Tests:**
- No trailing newline.
- Includes file path and line/range.
- Includes fenced code block.
- Trims the typed question.
- Separator can be disabled for future reuse.

**Verification:**

Run:

```bash
bun test apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffReviewComposer/utils/formatDiffReviewPrompt.test.ts
```

Expected: tests pass.

---

### Task 3: Add a terminal-agent target hook

**Objective:** List open terminal panes that can receive pasted draft text.

**Files:**
- Create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/hooks/useTerminalAgentTargets/useTerminalAgentTargets.ts`
- Create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/hooks/useTerminalAgentTargets/index.ts`
- Create test if store logic can be tested cheaply: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/hooks/useTerminalAgentTargets/useTerminalAgentTargets.test.ts`
- Read/reuse: `apps/desktop/src/renderer/stores/tabs/store.ts`
- Read/reuse: `apps/desktop/src/renderer/stores/tabs/terminal-callbacks.ts`

**Implementation notes:**

Use the current tabs store to find terminal panes in the same workspace, then check whether each pane has a registered paste callback:

```ts
const panes = useTabsStore((state) => state.panes);
const tabs = useTabsStore((state) => state.tabs);
const focusedPaneIds = useTabsStore((state) => state.focusedPaneIds);
const pasteCallbacks = useTerminalCallbacksStore((state) => state.pasteCallbacks);
```

Filter:
- `pane.type === "terminal"`
- pane's tab belongs to the current `workspaceId`

Label priority:
1. `pane.name` if set,
2. `pane.autoTitle` if available in pane type,
3. `Terminal <short pane id>`.

Sort:
1. focused terminal pane first,
2. active tab terminals next,
3. other workspace terminals after.

Return `isPasteReady: pasteCallbacks.has(pane.id)`. Disable targets that are not paste-ready rather than hiding them, so users understand why a terminal cannot receive text.

**Verification:**

Run:

```bash
bun run typecheck --filter=desktop
```

If no per-app filter exists, run the project-standard command:

```bash
bun run typecheck
```

Expected: typecheck passes.

---

### Task 4: Create `DiffReviewComposer` UI

**Objective:** Build the floating composer with textarea, terminal picker, and insert button.

**Files:**
- Create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffReviewComposer/DiffReviewComposer.tsx`
- Create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffReviewComposer/index.ts`
- Reuse UI imports from `@superset/ui/button`, `@superset/ui/textarea`, `@superset/ui/dropdown-menu` or `@superset/ui/select` depending on available components.

**Props:**

```ts
interface DiffReviewComposerProps {
  selection: DiffReviewSelection;
  targets: TerminalAgentTarget[];
  selectedTargetPaneId: string | null;
  onSelectedTargetPaneIdChange: (paneId: string) => void;
  onInsert: (question: string) => void;
  onClose: () => void;
  anchor: { x: number; y: number } | null;
}
```

**UI details:**
- Position absolute within the diff container when `anchor` exists; otherwise use a top-right floating panel.
- Use `z-50`, max width around `420px`, and keep it visually separate from code.
- Show a one-line snippet preview with `select-text cursor-text`.
- Textarea placeholder: `Ask about this code...`.
- Button label: `Insert in Terminal`.
- Disable insert if question is blank or no paste-ready target is selected.
- Show an empty state: `Open an agent terminal to insert review questions.`

**Accessibility:**
- Focus textarea on open.
- Escape closes composer.
- Do not steal text selection until plus button/composer is opened.

**Verification:**

Run:

```bash
bun run lint:fix
bun run lint
```

Expected: no Biome warnings/errors.

---

### Task 5: Add line hover plus button overlay to diff mode

**Objective:** Let users click a plus button on hover to create a comment anchored to a diff line.

**Files:**
- Modify: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/FileViewerContent.tsx`
- Optional create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffLineActionButton/DiffLineActionButton.tsx`
- Optional create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffLineActionButton/index.ts`

**Implementation notes:**

In the diff container:
- Track the currently hovered diff location in state using `onMouseMove` and `getDiffLocationFromEvent(event.nativeEvent)`.
- Convert the hovered location into a line selection with `buildLineReviewSelection`.
- Position a plus button using `location.lineElement.getBoundingClientRect()` and `diffContainerRef.current.getBoundingClientRect()`.
- Hide the button when the pointer leaves the diff container, when no valid location exists, or when the composer is open.

Pseudo-code:

```tsx
const [hoveredLineAction, setHoveredLineAction] = useState<{
  selection: DiffReviewSelection;
  anchor: { x: number; y: number };
} | null>(null);

onMouseMove={(event) => {
  const location = getDiffLocationFromEvent(event.nativeEvent);
  if (!location || !diffData || !diffContainerRef.current) {
    setHoveredLineAction(null);
    return;
  }
  const containerRect = diffContainerRef.current.getBoundingClientRect();
  const lineRect = location.lineElement.getBoundingClientRect();
  setHoveredLineAction({
    selection: buildLineReviewSelection({ filePath, contents: diffData, location }),
    anchor: { x: 8, y: lineRect.top - containerRect.top + diffContainerRef.current.scrollTop },
  });
}}
```

Clicking plus:
- Prevent default and stop propagation.
- Open `DiffReviewComposer` with the computed selection and anchor.
- Preserve the clicked line selection data independent of hover changes.

**Verification:**

Manual dev verification:

```bash
bun dev --filter=desktop
```

Expected:
- Hovering diff lines shows plus button.
- Moving across lines updates plus position.
- Clicking plus opens composer for that line.
- Existing context menu and `Edit Here` still work.

---

### Task 6: Add selection-driven composer entry points

**Objective:** Let users highlight code and create a review prompt from the selected text.

**Files:**
- Modify: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/FileViewerContent.tsx`
- Modify: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffViewerContextMenu/DiffViewerContextMenu.tsx`

**Implementation notes:**

Add a helper in `FileViewerContent`:

```ts
function getReviewSelectionFromActiveSelection(): DiffReviewSelection | null {
  const selectedText = window.getSelection()?.toString() ?? "";
  if (!selectedText.trim() || !lastDiffLocationRef.current || !diffData) return null;

  const lineSelection = buildLineReviewSelection({
    filePath,
    contents: diffData,
    location: lastDiffLocationRef.current,
  });

  return {
    ...lineSelection,
    selectedText,
  };
}
```

Then expose one or both entry points:

1. Context menu item in `DiffViewerContextMenu`:
   - Add prop `onAskAgentAboutSelection?: () => void`.
   - Add leading/context item `Ask Agent About Selection` when prop exists.
2. Optional floating selection bubble:
   - On `mouseup`, if selection is inside diff container, open a small button near selection rect.
   - Keep this optional if it adds too much complexity; context menu plus hover button cover v1.

**Verification:**

Manual:
- Highlight a multi-line snippet.
- Right-click and choose `Ask Agent About Selection`.
- Composer opens with highlighted text in snippet preview.
- Normal copy/select behavior still works.

---

### Task 7: Wire composer send to terminal paste callback

**Objective:** Insert the formatted review prompt into the selected terminal without sending.

**Files:**
- Modify: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/FileViewerContent.tsx`
- Read/reuse: `apps/desktop/src/renderer/stores/tabs/terminal-callbacks.ts`
- Use: `formatDiffReviewPrompt.ts`

**Implementation notes:**

In `FileViewerContent`:

```ts
const pasteCallbacks = useTerminalCallbacksStore((state) => state.pasteCallbacks);
const getPasteCallback = useTerminalCallbacksStore((state) => state.getPasteCallback);

const handleInsertReviewPrompt = (question: string) => {
  if (!activeReviewSelection || !selectedTargetPaneId) return;
  const paste = getPasteCallback(selectedTargetPaneId);
  if (!paste) {
    toast.error("That terminal is not ready for pasted input.");
    return;
  }

  paste(formatDiffReviewPrompt({
    selection: activeReviewSelection,
    question,
    appendSeparator: true,
  }));

  toast.success("Inserted review question into terminal draft.");
  setActiveReviewSelection(null);
};
```

Why `paste` and not `writeRef.current({ data })`:
- `paste` is already registered per terminal pane.
- It inserts text into xterm without adding Enter.
- It respects bracketed paste behavior for terminal applications.

Potential issue:
- `xterm.paste` may immediately write to a shell/agent process because terminal input is not a separate UI draft. This is expected for TUI/REPL agents: the text appears in their prompt area but is not submitted until Enter. Validate with Claude/Codex/OpenCode terminal agents.

**Verification:**

Manual:
- Open an agent terminal.
- Open a changed file in diff mode.
- Click plus, type `Why is this change needed?`, pick terminal, click `Insert in Terminal`.
- Confirm the prompt appears in the terminal and the agent has not executed until Enter is pressed.
- Repeat with another line; confirm the second prompt appends after a separator.

---

### Task 8: Add target picker behavior and defaulting

**Objective:** Make selecting a terminal agent low-friction and stable across multiple comments.

**Files:**
- Modify: `DiffReviewComposer.tsx`
- Modify: `FileViewerContent.tsx`
- Optional create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/TerminalAgentPicker/TerminalAgentPicker.tsx`
- Optional create: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/TerminalAgentPicker/index.ts`

**Implementation notes:**

Default target selection:
1. Use current `selectedTargetPaneId` if it is still paste-ready.
2. Else use focused paste-ready terminal pane in the active workspace/tab.
3. Else use first paste-ready terminal pane.
4. Else no target.

Keep the selection in `FileViewerContent` state while the file viewer pane stays mounted so repeated comments go to the same terminal by default.

Display target metadata:
- Terminal label.
- Tab name if needed to disambiguate.
- Disabled state if terminal exists but is not paste-ready.

Do not use the automation `AgentPicker` directly unless it is refactored into a generic picker. It lists configured agent presets, while this UX needs to target a live terminal session. If desired later, add a second action: `Open new <agent> terminal`, but keep v1 scoped to existing terminals.

**Verification:**

Manual:
- With one terminal open, it is selected by default.
- With multiple terminals open, focused terminal is selected first.
- With no terminals open, composer explains what to do and insert is disabled.
- Last selected target remains selected across multiple comments.

---

### Task 9: Polish layout, event handling, and edge cases

**Objective:** Avoid regressions in diff selection, scrolling, context menu, and pane actions.

**Files:**
- Modify: `FileViewerContent.tsx`
- Modify: new composer/button components from prior tasks

**Checklist:**
- Plus button should not appear over the composer.
- Plus button should not block selecting text except when directly clicked.
- Composer should remain anchored when the user types, but can close on scroll if anchoring gets complex.
- Escape closes composer without clearing diff selection unexpectedly.
- Clicking outside composer closes it.
- If the selected terminal unmounts before insert, show toast and keep composer open.
- Very long selected snippets should be truncated in preview but inserted fully unless larger than a reasonable cap.
- Add a cap, e.g. 12,000 characters, with UI text if truncated: `Snippet truncated to 12,000 characters.`

**Verification:**

Manual regression pass:
- Search in diff still opens and works.
- Right-click context menu still works.
- `Edit Here` still switches to raw file location.
- Diff scrollbar decorations still render.
- Side-by-side and unified diff modes both support plus/comment.
- Hidden unchanged regions do not crash hover mapping.

---

### Task 10: Run quality gates

**Objective:** Validate the implementation against repository standards.

**Files:**
- No new files unless fixes are needed.

**Commands:**

```bash
bun test apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/FileViewerContent/utils/diff-review-selection.test.ts
bun test apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/TabView/FileViewerPane/components/DiffReviewComposer/utils/formatDiffReviewPrompt.test.ts
bun run lint:fix
bun run lint
bun run typecheck
```

Expected:
- Targeted tests pass.
- `bun run lint` exits 0 with no warnings.
- `bun run typecheck` exits 0.

---

## Risks and Tradeoffs

1. Diff DOM coupling
   - The `@pierre/diffs/react` DOM may change. Mitigate by reusing existing `diff-location.ts` helpers and adding tests around helper behavior, not broad DOM snapshots.

2. Multi-line range precision
   - Mapping arbitrary DOM selection start/end to exact old/new line ranges may be brittle. V1 should prioritize selected text correctness and use the clicked/anchor line as the line reference. Improve exact range mapping later if needed.

3. Terminal target semantics
   - The requested `agent picker` could mean configured agent presets, but sending text requires a live terminal pane. V1 should target open terminal panes. A future enhancement can open a new terminal from a selected agent preset before inserting.

4. Pasting into terminal applications
   - `xterm.paste` may interact differently with shells vs full-screen TUIs. Validate with the actual terminal agents used by the app. If bracketed paste causes issues, add a renderer utility that can choose between `paste(text)` and `writeInput(text)` per target/application.

5. Stacking drafts
   - There is no reliable way to know whether the terminal input area already has unsent text. Always prepend a visible separator before inserted review questions so stacking is clear.

---

## Open Questions

1. Should the terminal picker show only terminal panes running known agent presets, or all terminal panes?
   - Recommendation: show all terminal panes in v1, label clearly, then add filtering if users accidentally paste into non-agent terminals.

2. Should plus buttons appear on unchanged context lines too?
   - Recommendation: yes, because review questions often refer to surrounding context.

3. Should prompts use absolute file paths or workspace-relative paths?
   - Recommendation: use whatever `filePath` currently stores for v1. If it is absolute, consider deriving workspace-relative later for readability.

4. Should inserted prompts include side (`old`/`new`) and diff type (`add`/`remove`/`context`)?
   - Recommendation: include this in the formatter after v1 if agents need more context.

---

## Acceptance Criteria

- Hovering a diff line shows a plus button.
- Clicking plus opens a composer anchored near that line.
- Highlighting code and using the context-menu action opens a composer with the highlighted snippet.
- Composer lets the user select an open terminal pane/agent target.
- Clicking `Insert in Terminal` inserts formatted text into that terminal only.
- The inserted text does not include an Enter/newline submission trigger.
- Multiple inserted comments can be stacked in the same terminal draft with separators.
- Existing diff actions (`Edit Here`, copy/select, search, side-by-side/unified mode) continue to work.
- `bun run lint` and `bun run typecheck` pass.
