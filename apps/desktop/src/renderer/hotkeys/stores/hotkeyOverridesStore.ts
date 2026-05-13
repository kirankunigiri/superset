import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ShortcutBinding } from "../types";

interface HotkeyOverridesState {
	/** Per-hotkey-id override. `null` = explicit unassignment. Stored as the
	 *  ShortcutBinding shape: bare string for physical-mode bindings (legacy
	 *  + shipped defaults), v2 object for logical / named modes. */
	overrides: Record<string, ShortcutBinding | null>;
	webviewOverrides: Record<string, boolean>;
	setOverride: (id: string, binding: ShortcutBinding | null) => void;
	setWebviewOverride: (id: string, enabled: boolean) => void;
	resetOverride: (id: string) => void;
	resetAll: () => void;
}

export const useHotkeyOverridesStore = create<HotkeyOverridesState>()(
	persist(
		(set) => ({
			overrides: {},
			webviewOverrides: {},
			setOverride: (id, keys) =>
				set((state) => ({
					overrides: { ...state.overrides, [id]: keys },
				})),
			setWebviewOverride: (id, enabled) =>
				set((state) => ({
					webviewOverrides: { ...state.webviewOverrides, [id]: enabled },
				})),
			resetOverride: (id) =>
				set((state) => {
					const next = { ...state.overrides };
					delete next[id];
					const nextWv = { ...state.webviewOverrides };
					delete nextWv[id];
					return { overrides: next, webviewOverrides: nextWv };
				}),
			resetAll: () => set({ overrides: {}, webviewOverrides: {} }),
		}),
		{
			name: "hotkey-overrides",
			storage: createJSONStorage(() => localStorage),
			partialize: (state) => ({
				overrides: state.overrides,
				webviewOverrides: state.webviewOverrides,
			}),
		},
	),
);
