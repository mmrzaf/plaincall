import type { ScreenShareCaptureOptions, TrackPublishOptions, VideoCaptureOptions, VideoEncoding } from 'livekit-client';

/**
 * Room presets. A host picks one when starting a room, and every browser in it
 * applies the same settings to its camera and screen share.
 */
export type Quality = 'presentation' | 'meeting' | 'low';

export const DEFAULT_QUALITY: Quality = 'presentation';

export const QUALITIES: readonly { id: Quality; label: string; hint: string }[] = [
  { id: 'presentation', label: 'Presentation', hint: 'Sharp slides and documents' },
  { id: 'meeting', label: 'Meeting', hint: 'Smooth video and demos' },
  { id: 'low', label: 'Low bandwidth', hint: 'Smaller video for weak connections' },
];

export function isQuality(value: unknown): value is Quality {
  return value === 'presentation' || value === 'meeting' || value === 'low';
}

interface Preset {
  screen: { capture: Pick<ScreenShareCaptureOptions, 'resolution' | 'contentHint'>; publish: TrackPublishOptions };
  camera: { capture: Pick<VideoCaptureOptions, 'resolution'>; encoding: VideoEncoding };
}

/*
 * Screen shares are the reason for presets. With several layers, a viewer's
 * browser is often handed the half-size one, which turns text soft while the
 * frame rate stays high. Presentation and Low bandwidth therefore publish one
 * layer at a low frame rate, so every viewer gets the full picture. Slides only
 * cost bits when they change.
 */
const PRESETS: Record<Quality, Preset> = {
  presentation: {
    screen: {
      capture: { resolution: { width: 1920, height: 1080, frameRate: 8 }, contentHint: 'text' },
      publish: {
        screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 8 },
        simulcast: false,
        degradationPreference: 'maintain-resolution',
      },
    },
    camera: {
      capture: { resolution: { width: 1280, height: 720, frameRate: 24 } },
      encoding: { maxBitrate: 900_000, maxFramerate: 24 },
    },
  },
  meeting: {
    screen: {
      capture: { resolution: { width: 1920, height: 1080, frameRate: 30 }, contentHint: 'motion' },
      publish: {
        screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 30 },
        degradationPreference: 'maintain-framerate',
      },
    },
    camera: {
      capture: { resolution: { width: 1280, height: 720, frameRate: 30 } },
      encoding: { maxBitrate: 1_700_000, maxFramerate: 30 },
    },
  },
  low: {
    screen: {
      capture: { resolution: { width: 1280, height: 720, frameRate: 5 }, contentHint: 'text' },
      publish: {
        screenShareEncoding: { maxBitrate: 1_000_000, maxFramerate: 5 },
        simulcast: false,
        degradationPreference: 'maintain-resolution',
      },
    },
    camera: {
      capture: { resolution: { width: 640, height: 360, frameRate: 15 } },
      encoding: { maxBitrate: 400_000, maxFramerate: 15 },
    },
  },
};

/** Capture and publish settings for a screen share in a room. */
export function screenShareSettings(quality: Quality): Preset['screen'] {
  return PRESETS[quality].screen;
}

/** Capture settings for the camera, before a device is chosen. */
export function cameraCapture(quality: Quality): Pick<VideoCaptureOptions, 'resolution'> {
  return PRESETS[quality].camera.capture;
}

/** Publish settings for the camera. */
export function cameraPublish(quality: Quality): TrackPublishOptions {
  return { videoEncoding: PRESETS[quality].camera.encoding };
}
