import { FEATURE_FLAGS } from "@superset/shared/constants";
import { Button } from "@superset/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { useCallback, useEffect, useState } from "react";
import { useWorkspaceServiceClient } from "renderer/hooks/useWorkspaceServiceClient";

type HealthStatus = "unknown" | "ok" | "error";

interface ServiceInfo {
	platform: string;
	arch: string;
	nodeVersion: string;
	uptime: number;
}

export function WorkspaceServiceStatus() {
	const enabled = useFeatureFlagEnabled(FEATURE_FLAGS.V2_CLOUD);
	const { client } = useWorkspaceServiceClient();
	const [status, setStatus] = useState<HealthStatus>("unknown");
	const [info, setInfo] = useState<ServiceInfo | null>(null);

	const checkHealth = useCallback(async () => {
		if (!client) {
			setStatus("unknown");
			return;
		}

		try {
			const result = await client.health.check.query();
			setStatus(result.status === "ok" ? "ok" : "error");
		} catch {
			setStatus("error");
		}
	}, [client]);

	const fetchInfo = useCallback(async () => {
		if (!client) return;

		try {
			const result = await client.health.info.query();
			setInfo(result);
		} catch {
			setInfo(null);
		}
	}, [client]);

	useEffect(() => {
		checkHealth();
		const interval = setInterval(checkHealth, 15_000);
		return () => clearInterval(interval);
	}, [checkHealth]);

	if (!enabled) return null;

	const dotColor =
		status === "ok"
			? "bg-green-500"
			: status === "error"
				? "bg-red-500"
				: "bg-yellow-500";

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					onClick={() => fetchInfo()}
				>
					<span className={`size-2 rounded-full ${dotColor}`} />
				</Button>
			</PopoverTrigger>
			<PopoverContent side="top" align="start" className="w-64 text-xs">
				<div className="space-y-1">
					<div className="font-medium">Workspace Service</div>
					<div className="text-muted-foreground">Status: {status}</div>
					{info && (
						<>
							<div className="text-muted-foreground">
								Platform: {info.platform} ({info.arch})
							</div>
							<div className="text-muted-foreground">
								Node: {info.nodeVersion}
							</div>
							<div className="text-muted-foreground">
								Uptime: {Math.floor(info.uptime)}s
							</div>
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
