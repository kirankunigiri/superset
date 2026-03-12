import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";

interface DevicePickerProps {
	selectedDeviceId: string | null;
	onSelectDevice: (id: string | null) => void;
}

export function DevicePicker({
	selectedDeviceId,
	onSelectDevice,
}: DevicePickerProps) {
	const collections = useCollections();
	const { data: deviceInfo } = electronTrpc.auth.getDeviceInfo.useQuery();

	const { data: allDevices } = useLiveQuery(
		(q) =>
			q
				.from({ devices: collections.v2Devices })
				.select(({ devices }) => ({ ...devices })),
		[collections],
	);

	const { data: userDeviceLinks } = useLiveQuery(
		(q) =>
			q
				.from({ ud: collections.v2UsersDevices })
				.select(({ ud }) => ({ ...ud })),
		[collections],
	);

	const localHostDevice = useMemo(() => {
		if (!allDevices || !deviceInfo) return null;
		return (
			allDevices.find(
				(d) => d.type === "host" && d.clientId === deviceInfo.deviceId,
			) ?? null
		);
	}, [allDevices, deviceInfo]);

	const accessibleDeviceIds = useMemo(() => {
		if (!userDeviceLinks) return new Set<string>();
		return new Set(userDeviceLinks.map((link) => link.deviceId));
	}, [userDeviceLinks]);

	const otherDevices = useMemo(() => {
		if (!allDevices) return [];
		return allDevices.filter(
			(d) => d.id !== localHostDevice?.id && accessibleDeviceIds.has(d.id),
		);
	}, [allDevices, localHostDevice, accessibleDeviceIds]);

	const effectiveValue = selectedDeviceId ?? "local";

	return (
		<Select
			value={effectiveValue}
			onValueChange={(value) =>
				onSelectDevice(value === "local" ? null : value)
			}
		>
			<SelectTrigger className="h-7 text-xs w-auto min-w-[120px] gap-1">
				<SelectValue placeholder="Select device" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="local">
					This device
					{localHostDevice ? ` (${localHostDevice.name})` : ""}
				</SelectItem>
				{otherDevices.map((device) => (
					<SelectItem key={device.id} value={device.id}>
						{device.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
