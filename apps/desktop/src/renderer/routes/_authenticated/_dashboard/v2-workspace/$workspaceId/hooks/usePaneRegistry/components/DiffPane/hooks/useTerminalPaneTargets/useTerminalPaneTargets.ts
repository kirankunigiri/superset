import { BUILTIN_AGENT_LABELS } from "@superset/shared/agent-catalog";
import { useMemo } from "react";
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
} {
	const store = getV2PaneStore(workspaceId);
	const agentBindings = useV2AgentBindingStore((s) => s.byTerminalId);

	return useMemo(() => {
		if (!store) return { targets: [] };

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

		all.sort((a, b) => {
			if (a.isAgent !== b.isAgent) return a.isAgent ? -1 : 1;
			return a.label.localeCompare(b.label);
		});

		return { targets: all };
	}, [store, agentBindings]);
}
