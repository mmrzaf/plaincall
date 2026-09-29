// Settings kept in this browser. Storage can be unavailable (private modes,
// blocked cookies), so every access tolerates failure.

import { DEFAULT_QUALITY, isQuality, type Quality } from './quality';

const PREFIX = 'plaincall.';

function read(name: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + name);
  } catch {
    return null;
  }
}

function write(name: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + name);
    else window.localStorage.setItem(PREFIX + name, value);
  } catch {
    // Nothing useful to do; the setting just will not be remembered.
  }
}

export type DeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';
export type DeviceChoices = Partial<Record<DeviceKind, string>>;

export interface Preferences {
  micOn: boolean;
  cameraOn: boolean;
  mirror: boolean;
}

const DEFAULT_PREFERENCES: Preferences = { micOn: true, cameraOn: true, mirror: true };

export const storage = {
  getName: (): string => read('name') ?? '',
  setName: (name: string): void => write('name', name),

  getQuality: (): Quality => {
    const stored = read('quality');
    return isQuality(stored) ? stored : DEFAULT_QUALITY;
  },
  setQuality: (quality: Quality): void => write('quality', quality),

  getKey: (): string => read('key') ?? '',
  setKey: (key: string): void => write('key', key),
  clearKey: (): void => write('key', null),

  getDevices(): DeviceChoices {
    try {
      const parsed: unknown = JSON.parse(read('devices') ?? '{}');
      if (typeof parsed !== 'object' || parsed === null) return {};
      const choices: DeviceChoices = {};
      for (const kind of ['audioinput', 'audiooutput', 'videoinput'] as const) {
        const id = (parsed as Record<string, unknown>)[kind];
        if (typeof id === 'string' && id) choices[kind] = id;
      }
      return choices;
    } catch {
      return {};
    }
  },
  setDevices: (choices: DeviceChoices): void => write('devices', JSON.stringify(choices)),

  getPreferences(): Preferences {
    try {
      const parsed: unknown = JSON.parse(read('preferences') ?? '{}');
      const source = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const flag = (name: keyof Preferences): boolean =>
        typeof source[name] === 'boolean' ? (source[name] as boolean) : DEFAULT_PREFERENCES[name];
      return { micOn: flag('micOn'), cameraOn: flag('cameraOn'), mirror: flag('mirror') };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  },
  setPreferences: (preferences: Preferences): void => write('preferences', JSON.stringify(preferences)),
};
