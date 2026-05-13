import type { WorkspaceStore } from "@superset/panes";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { StoreApi } from "zustand/vanilla";

type V2PaneStore = StoreApi<WorkspaceStore<PaneViewerData>>;

interface V2WorkspaceEntry {
	store: V2PaneStore;
	hostUrl: string;
}

const g = globalThis as Record<string, unknown>;
if (!g.__v2PaneStoreRegistry) {
	g.__v2PaneStoreRegistry = new Map<string, V2WorkspaceEntry>();
}
const registry = g.__v2PaneStoreRegistry as Map<string, V2WorkspaceEntry>;

export function registerV2PaneStore(
	workspaceId: string,
	store: V2PaneStore,
	hostUrl: string,
): void {
	registry.set(workspaceId, { store, hostUrl });
}

export function unregisterV2PaneStore(workspaceId: string): void {
	registry.delete(workspaceId);
}

export function getV2PaneStore(workspaceId: string): V2PaneStore | undefined {
	return registry.get(workspaceId)?.store;
}

export function getV2HostUrl(workspaceId: string): string | undefined {
	return registry.get(workspaceId)?.hostUrl;
}

export function getV2PaneStores(): Map<string, V2PaneStore> {
	const stores = new Map<string, V2PaneStore>();
	for (const [id, entry] of registry) {
		stores.set(id, entry.store);
	}
	return stores;
}
