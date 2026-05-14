import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  VideoPresets,
  createLocalAudioTrack,
  createLocalVideoTrack,
  supportsAudioOutputSelection,
} from 'livekit-client';
import type { DeviceKind } from './storage';

export { supportsAudioOutputSelection };

/** Lists the devices of one kind. Labels are empty until permission is granted. */
export async function listDevices(kind: DeviceKind): Promise<MediaDeviceInfo[]> {
  try {
    return await Room.getLocalDevices(kind, false);
  } catch {
    return [];
  }
}

/** Voice capture settings shared by the preview and the call. */
export function microphoneOptions(deviceId?: string) {
  return {
    deviceId: deviceId ? { ideal: deviceId } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

/** Camera capture settings shared by the preview and the call. */
export function cameraOptions(deviceId?: string) {
  return {
    deviceId: deviceId ? { ideal: deviceId } : undefined,
    resolution: VideoPresets.h720.resolution,
  };
}

export function openMicrophone(deviceId?: string): Promise<LocalAudioTrack> {
  return createLocalAudioTrack(microphoneOptions(deviceId));
}

export function openCamera(deviceId?: string): Promise<LocalVideoTrack> {
  return createLocalVideoTrack(cameraOptions(deviceId));
}

/** A short, human explanation of why a device could not be opened. */
export function deviceErrorMessage(error: unknown, what: 'microphone' | 'camera' | 'screen'): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return what === 'screen'
        ? 'Screen sharing was cancelled or blocked.'
        : `Allow ${what} access in your browser to use it.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${what} was found.`;
    case 'NotReadableError':
    case 'AbortError':
      return `The ${what} is busy or unavailable. Close other apps that may be using it.`;
    default:
      return `Could not start the ${what}.`;
  }
}

/** True when the browser was told to abandon a screen-share prompt. */
export function isScreenShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

/** Fills a <select> with devices and selects `selected` when it is present. */
export function fillDeviceSelect(select: HTMLSelectElement, devices: MediaDeviceInfo[], fallbackLabel: string, selected?: string): void {
  select.replaceChildren();
  const seen = new Set<string>();
  devices.forEach((device, index) => {
    if (seen.has(device.deviceId)) return;
    seen.add(device.deviceId);
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(option);
  });
  if (select.options.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = `No ${fallbackLabel.toLowerCase()} found`;
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  if (selected && seen.has(selected)) select.value = selected;
}
