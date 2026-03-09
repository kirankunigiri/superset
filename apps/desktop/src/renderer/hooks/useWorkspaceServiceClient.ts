import { useMemo } from "react";
import { authClient } from "renderer/lib/auth-client";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getWorkspaceServiceClient } from "renderer/lib/workspace-service-client";

export function useWorkspaceServiceClient() {
	const { data: session } = authClient.useSession();
	const organizationId = session?.session?.activeOrganizationId ?? null;

	const { data: portData } =
		electronTrpc.workspaceServiceManager.getLocalPort.useQuery(
			{ organizationId: organizationId as string },
			{ enabled: !!organizationId },
		);

	const client = useMemo(() => {
		if (!portData?.port) return null;
		return getWorkspaceServiceClient(portData.port);
	}, [portData?.port]);

	return { client, organizationId };
}
