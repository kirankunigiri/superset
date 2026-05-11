import type { RendererContext } from "@superset/panes";
import { useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { DevtoolsPaneData, PaneViewerData } from "../../../../types";

export function DevtoolsPane({
	ctx,
}: {
	ctx: RendererContext<PaneViewerData>;
}) {
	const data = ctx.pane.data as DevtoolsPaneData;
	const [devtoolsUrl, setDevtoolsUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		electronTrpcClient.browser.getDevToolsUrl
			.query({ paneId: data.targetPaneId })
			.then((result) => {
				if (result.url) {
					setDevtoolsUrl(result.url);
				} else {
					setError("Could not find DevTools target. Is CDP enabled?");
				}
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : String(err));
			});
	}, [data.targetPaneId]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !devtoolsUrl) return;

		const webview = document.createElement("webview") as Electron.WebviewTag;
		webview.src = devtoolsUrl;
		webview.style.width = "100%";
		webview.style.height = "100%";
		container.appendChild(webview);

		return () => {
			if (container.contains(webview)) {
				container.removeChild(webview);
			}
		};
	}, [devtoolsUrl]);

	if (error) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				{error}
			</div>
		);
	}

	if (!devtoolsUrl) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Connecting DevTools...
			</div>
		);
	}

	return <div ref={containerRef} className="h-full w-full" />;
}
