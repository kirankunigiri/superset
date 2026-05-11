import type { RendererContext } from "@superset/panes";
import { useCallback, useEffect, useRef } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type {
	BrowserPaneData,
	PaneViewerData,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import { DEFAULT_BROWSER_URL } from "../../constants";

interface UsePersistentWebviewOptions {
	paneId: string;
	ctx: RendererContext<PaneViewerData>;
	workspaceCwd?: string;
}

export function usePersistentWebview({
	paneId,
	ctx,
	workspaceCwd,
}: UsePersistentWebviewOptions) {
	const placeholderRef = useRef<HTMLDivElement | null>(null);
	const ctxRef = useRef(ctx);
	ctxRef.current = ctx;

	const paneData = ctx.pane.data as BrowserPaneData;
	const initialUrlRef = useRef(paneData.url || DEFAULT_BROWSER_URL);

	// biome-ignore lint/correctness/useExhaustiveDependencies: workspaceCwd is handled by a separate setCwd effect; re-attaching on cwd change causes webview reset
	useEffect(() => {
		const placeholder = placeholderRef.current;
		if (!placeholder) return;

		browserRuntimeRegistry.attach(
			paneId,
			placeholder,
			initialUrlRef.current,
			({ url, pageTitle, faviconUrl }) => {
				const current = ctxRef.current.pane.data as BrowserPaneData;
				if (
					current.url === url &&
					current.pageTitle === pageTitle &&
					current.faviconUrl === faviconUrl
				)
					return;
				ctxRef.current.actions.updateData({
					...current,
					url,
					pageTitle,
					faviconUrl,
				});
			},
			workspaceCwd,
		);

		return () => {
			browserRuntimeRegistry.detach(paneId);
		};
	}, [paneId]);

	useEffect(() => {
		if (workspaceCwd) {
			electronTrpcClient.browser.setCwd
				.mutate({ paneId, workspaceCwd })
				.catch(() => {});
		}
	}, [paneId, workspaceCwd]);

	useEffect(() => {
		const newWindowSub = electronTrpcClient.browser.onNewWindow.subscribe(
			{ paneId },
			{
				onData: ({ url }: { url: string }) => {
					ctxRef.current.actions.split("right", {
						kind: "browser",
						data: { url } as BrowserPaneData,
					});
				},
			},
		);
		const contextMenuSub =
			electronTrpcClient.browser.onContextMenuAction.subscribe(
				{ paneId },
				{
					onData: ({ action, url }: { action: string; url: string }) => {
						if (action === "open-in-split") {
							ctxRef.current.actions.split("right", {
								kind: "browser",
								data: { url } as BrowserPaneData,
							});
						}
					},
				},
			);
		return () => {
			newWindowSub.unsubscribe();
			contextMenuSub.unsubscribe();
		};
	}, [paneId]);

	const goBack = useCallback(() => {
		browserRuntimeRegistry.goBack(paneId);
	}, [paneId]);

	const goForward = useCallback(() => {
		browserRuntimeRegistry.goForward(paneId);
	}, [paneId]);

	const reload = useCallback(() => {
		browserRuntimeRegistry.reload(paneId);
	}, [paneId]);

	const navigateTo = useCallback(
		(url: string) => {
			browserRuntimeRegistry.navigate(paneId, url);
		},
		[paneId],
	);

	return {
		placeholderRef,
		goBack,
		goForward,
		reload,
		navigateTo,
	};
}
