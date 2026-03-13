/**
 * Guard against the value-sync `useEffect` overwriting user edits.
 *
 * React's `useEffect` runs asynchronously after paint.  Between the render
 * commit and effect execution a user can type or paste into CodeMirror.  If
 * that edit does **not** trigger a React re-render (e.g. `setIsDirty(true)`
 * when `isDirty` is already `true`), the pending effect still holds the
 * **stale** `value` from the previous render and will overwrite the edit.
 *
 * `ValueSyncGuard` tracks the last value that was successfully synced to
 * the editor by the effect.  Before dispatching, the effect compares the
 * editor's current content against `lastSynced`:
 *
 *  - If they match → no user edit happened since the last sync → safe to
 *    dispatch the new `value`.
 *  - If they differ → the user edited since the last sync → skip the
 *    dispatch and let the parent re-render with the updated value.
 */
export interface ValueSyncGuard {
	/** The last value that was successfully synced from props → editor. */
	lastSynced: string;
}

export function createValueSyncGuard(initialValue: string): ValueSyncGuard {
	return { lastSynced: initialValue };
}

/**
 * Decide whether the value-sync effect should dispatch `nextPropValue` into
 * the editor, and if so, update the guard.
 *
 * @returns `true` when the effect should dispatch, `false` when it should
 *   skip (because a user edit happened since the last sync).
 */
export function shouldSyncValue(
	guard: ValueSyncGuard,
	currentEditorValue: string,
	nextPropValue: string,
): boolean {
	// Editor already shows the desired value – nothing to do.
	if (currentEditorValue === nextPropValue) {
		guard.lastSynced = nextPropValue;
		return false;
	}

	// The editor content has diverged from the last synced value, meaning the
	// user (or adapter.setValue) edited the document since the last sync.
	// Don't overwrite – the parent will re-render with the updated value.
	if (currentEditorValue !== guard.lastSynced) {
		return false;
	}

	// Editor still shows the last-synced value, but the prop changed.
	// This is a legitimate external update (file reload, revert, etc.).
	guard.lastSynced = nextPropValue;
	return true;
}
