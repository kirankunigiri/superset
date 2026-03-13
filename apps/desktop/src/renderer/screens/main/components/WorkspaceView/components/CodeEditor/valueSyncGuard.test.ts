import { describe, expect, test } from "bun:test";
import { createValueSyncGuard, shouldSyncValue } from "./valueSyncGuard";

describe("valueSyncGuard", () => {
	describe("shouldSyncValue", () => {
		test("returns false when editor already matches prop value (no-op)", () => {
			const guard = createValueSyncGuard("hello");
			expect(shouldSyncValue(guard, "hello", "hello")).toBe(false);
		});

		test("returns true for legitimate external value change", () => {
			const guard = createValueSyncGuard("original");
			// Editor shows "original" (last synced), prop changed to "updated"
			expect(shouldSyncValue(guard, "original", "updated")).toBe(true);
			expect(guard.lastSynced).toBe("updated");
		});

		test("returns false when user edited since last sync (paste bug)", () => {
			const guard = createValueSyncGuard("A");

			// Simulate the paste bug scenario:
			// 1. Last sync set editor to "A"
			// 2. User types "B" → editor is now "AB"
			// 3. React renders with value="AB", schedules effect
			// 4. User pastes "C" → editor is now "ABC"
			// 5. Effect runs with stale value="AB"

			// At step 5, editor has "ABC" but effect wants to sync "AB".
			// The guard detects the editor diverged from lastSynced ("A")
			// and blocks the overwrite.
			expect(shouldSyncValue(guard, "ABC", "AB")).toBe(false);
		});

		test("reproduces issue #2459: paste reverts to clean slate", () => {
			// Full reproduction of the reported bug:
			//
			// 1. File loads with content "original content"
			const guard = createValueSyncGuard("original content");

			// 2. Initial sync effect runs — editor matches prop
			expect(
				shouldSyncValue(guard, "original content", "original content"),
			).toBe(false);

			// 3. User types a character, e.g., "!" at the end
			//    → editor = "original content!"
			//    → onChange fires, parent re-renders with value = "original content!"
			//    → sync effect is scheduled (async, after paint)

			// 4. Sync effect runs: editor="original content!", value="original content!"
			//    — no-op because they match
			expect(
				shouldSyncValue(guard, "original content!", "original content!"),
			).toBe(false);
			// lastSynced is now "original content!"

			// 5. Some state change triggers re-render; value = "original content!" (same)
			//    → effect is scheduled again (value changed on this render? no, same.)
			//    Actually, effect only re-runs when value changes. So let's say:

			// 6. Another edit: user pastes "PASTED" at the end
			//    → editor = "original content!PASTED"
			//    → onChange fires: draftRef updated, setIsDirty(true) — but isDirty
			//      was already true, so NO re-render
			//    → A previously scheduled effect from step 5 still has
			//      value = "original content!"

			// 7. The stale effect runs. WITHOUT the guard, it would:
			//    currentValue="original content!PASTED" !== value="original content!"
			//    → dispatch replacement → editor reverts to "original content!"
			//    → PASTE LOST!

			// WITH the guard:
			expect(
				shouldSyncValue(guard, "original content!PASTED", "original content!"),
			).toBe(false); // Blocked! Editor diverged from lastSynced.

			// 8. Eventually a re-render happens with value = "original content!PASTED"
			expect(
				shouldSyncValue(
					guard,
					"original content!PASTED",
					"original content!PASTED",
				),
			).toBe(false); // no-op, already matches
			expect(guard.lastSynced).toBe("original content!PASTED");
		});

		test("allows file revert after user edit", () => {
			const guard = createValueSyncGuard("original");

			// User edits → parent re-renders → sync effect runs
			expect(shouldSyncValue(guard, "edited", "edited")).toBe(false);
			// lastSynced = "edited"

			// File revert: parent sets value back to "original"
			// Editor still shows "edited" (from the user's edit)
			// lastSynced = "edited" (matches editor) → safe to sync
			expect(shouldSyncValue(guard, "edited", "original")).toBe(true);
			expect(guard.lastSynced).toBe("original");
		});

		test("allows external file reload while editor is clean", () => {
			const guard = createValueSyncGuard("v1");

			// File changes on disk, query refetches, value becomes "v2"
			// Editor still shows "v1" (last synced)
			expect(shouldSyncValue(guard, "v1", "v2")).toBe(true);
			expect(guard.lastSynced).toBe("v2");
		});

		test("handles adapter.setValue() followed by prop update", () => {
			const guard = createValueSyncGuard("A");

			// adapter.setValue("B") changes editor directly (not via sync effect)
			// Editor now shows "B", lastSynced = "A"

			// Parent re-renders with value = "B"
			// Editor = "B", value = "B" → no-op
			expect(shouldSyncValue(guard, "B", "B")).toBe(false);
			expect(guard.lastSynced).toBe("B");
		});

		test("handles rapid sequential edits without re-render", () => {
			const guard = createValueSyncGuard("start");

			// Sync effect runs with initial value
			expect(shouldSyncValue(guard, "start", "start")).toBe(false);

			// User types rapidly: "start" → "start1" → "start12" → "start123"
			// Each triggers onChange, but only the first setIsDirty(true) causes a
			// re-render. The effect from that render has value = "start1".
			// By the time it runs, editor has "start123".

			// Effect runs with stale value "start1":
			expect(shouldSyncValue(guard, "start123", "start1")).toBe(false);
			// Blocked — editor diverged from lastSynced ("start")

			// Eventually re-render with value = "start123":
			expect(shouldSyncValue(guard, "start123", "start123")).toBe(false);
			expect(guard.lastSynced).toBe("start123");
		});

		test("handles line ending normalization (CRLF to LF)", () => {
			// File has CRLF, CodeMirror normalizes to LF
			const guard = createValueSyncGuard("line1\r\nline2");

			// After CodeMirror normalizes, editor has LF but prop has CRLF
			// The init effect created the editor with CRLF, CodeMirror normalized to LF
			// First sync effect: editor="line1\nline2", value="line1\r\nline2"
			// Editor diverged from lastSynced (CRLF) due to normalization
			// lastSynced = "line1\r\nline2", currentValue = "line1\nline2"
			// currentValue !== lastSynced → skip (treats normalization as an "edit")
			expect(shouldSyncValue(guard, "line1\nline2", "line1\r\nline2")).toBe(
				false,
			);

			// On next render, onChange will have reported "line1\nline2" → draftRef
			// set → value = "line1\nline2"
			expect(shouldSyncValue(guard, "line1\nline2", "line1\nline2")).toBe(
				false,
			);
			expect(guard.lastSynced).toBe("line1\nline2");
		});
	});
});
