import { fillDeviceSelect, listDevices } from '../devices';
import type { DeviceKind } from '../storage';

export type DeviceSelectors = Record<DeviceKind, HTMLSelectElement>;

const LABELS: Record<DeviceKind, string> = {
  audioinput: 'Microphone',
  audiooutput: 'Speaker',
  videoinput: 'Camera',
};

/** Fills every device <select> with the current devices, choosing the active ones. */
export async function deviceOptionsFor(
  selectors: DeviceSelectors,
  active: (kind: DeviceKind) => string | undefined,
): Promise<void> {
  const kinds = Object.keys(selectors) as DeviceKind[];
  const lists = await Promise.all(kinds.map((kind) => listDevices(kind)));
  kinds.forEach((kind, index) => {
    fillDeviceSelect(selectors[kind], lists[index] ?? [], LABELS[kind], active(kind));
  });
}
