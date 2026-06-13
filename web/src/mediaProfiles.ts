import {
  AudioPresets,
  ScreenSharePresets,
  VideoPresets,
  type AudioCaptureOptions,
  type AudioPreset,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
} from 'livekit-client';

export type MediaProfileID = 'voice' | 'balanced' | 'sharp' | 'smooth' | 'audio-only';
export type AudioProfileID = 'resilient' | 'speech' | 'clear';
export type CameraFacing = 'user' | 'environment';
export type ScreenProfileID = 'text' | 'motion';

export type MediaProfile = {
  id: MediaProfileID;
  label: string;
  description: string;
  audioOnly: boolean;
  width: number;
  height: number;
  fps: number;
  maxBitrate: number;
  degradationPreference: RTCDegradationPreference;
  simulcastLayers: typeof VideoPresets.h180[];
};

export type AudioProfile = {
  id: AudioProfileID;
  label: string;
  description: string;
  preset: AudioPreset;
};

export const MEDIA_PROFILES: Record<MediaProfileID, MediaProfile> = {
  voice: {
    id: 'voice', label: 'Voice first', description: 'Spend less bandwidth on video so speech has room to recover', audioOnly: false,
    width: 640, height: 360, fps: 15, maxBitrate: 350_000, degradationPreference: 'balanced',
    simulcastLayers: [VideoPresets.h180],
  },
  balanced: {
    id: 'balanced', label: 'Balanced', description: 'Good default for most calls', audioOnly: false,
    width: 1280, height: 720, fps: 24, maxBitrate: 1_200_000, degradationPreference: 'balanced',
    simulcastLayers: [VideoPresets.h180, VideoPresets.h360],
  },
  sharp: {
    id: 'sharp', label: 'Sharp video', description: 'Prioritize detail and readable visuals', audioOnly: false,
    width: 1920, height: 1080, fps: 20, maxBitrate: 2_500_000, degradationPreference: 'maintain-resolution',
    simulcastLayers: [VideoPresets.h360, VideoPresets.h720],
  },
  smooth: {
    id: 'smooth', label: 'Smooth motion', description: 'Prioritize frame rate for movement', audioOnly: false,
    width: 1280, height: 720, fps: 30, maxBitrate: 1_800_000, degradationPreference: 'maintain-framerate',
    simulcastLayers: [VideoPresets.h180, VideoPresets.h360],
  },
  'audio-only': {
    id: 'audio-only', label: 'Audio only', description: 'Maximum voice stability and minimum data use', audioOnly: true,
    width: 0, height: 0, fps: 0, maxBitrate: 0, degradationPreference: 'balanced', simulcastLayers: [],
  },
};

export const AUDIO_PROFILES: Record<AudioProfileID, AudioProfile> = {
  resilient: {
    id: 'resilient', label: 'Maximum stability', description: '12kbps mono speech for weak or unstable links', preset: AudioPresets.telephone,
  },
  speech: {
    id: 'speech', label: 'Balanced speech', description: '24kbps mono speech for normal calls', preset: AudioPresets.speech,
  },
  clear: {
    id: 'clear', label: 'Clear speech', description: '48kbps mono voice when the network has room', preset: AudioPresets.music,
  },
};

export function mediaProfile(id: string | null | undefined): MediaProfile {
  return MEDIA_PROFILES[id as MediaProfileID] ?? MEDIA_PROFILES.balanced;
}

export function audioProfile(id: string | null | undefined): AudioProfile {
  return AUDIO_PROFILES[id as AudioProfileID] ?? AUDIO_PROFILES.speech;
}

export function videoCaptureOptions(deviceID: string, facing: CameraFacing, profile: MediaProfile): VideoCaptureOptions {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    facingMode: deviceID ? undefined : facing,
    resolution: { width: profile.width, height: profile.height, frameRate: profile.fps },
    frameRate: { ideal: profile.fps, max: profile.fps },
  };
}

export function browserVideoConstraints(deviceID: string, facing: CameraFacing, profile: MediaProfile): MediaTrackConstraints {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    facingMode: deviceID ? undefined : { ideal: facing },
    // Cap preview capture as well as preferring the selected size. Browsers are
    // allowed to ignore ideal-only constraints, which made every profile look alike.
    width: { ideal: profile.width, max: profile.width },
    height: { ideal: profile.height, max: profile.height },
    frameRate: { ideal: profile.fps, max: profile.fps },
  };
}

export function cameraPublishOptions(profile: MediaProfile): TrackPublishOptions {
  return {
    simulcast: true,
    videoEncoding: { maxBitrate: profile.maxBitrate, maxFramerate: profile.fps },
    videoSimulcastLayers: profile.simulcastLayers,
    degradationPreference: profile.degradationPreference,
  };
}

export function audioCaptureOptions(deviceID: string): AudioCaptureOptions {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

export function browserAudioConstraints(deviceID: string): MediaTrackConstraints {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

export function audioPublishOptions(profile: AudioProfile): TrackPublishOptions {
  return { audioPreset: profile.preset, red: true, dtx: true, forceStereo: false };
}

export function screenCaptureOptions(id: ScreenProfileID): ScreenShareCaptureOptions {
  if (id === 'motion') {
    return { audio: false, resolution: { width: 1280, height: 720, frameRate: 30 }, contentHint: 'motion' };
  }
  return { audio: false, resolution: { width: 1920, height: 1080, frameRate: 15 }, contentHint: 'text' };
}

export function screenPublishOptions(id: ScreenProfileID): TrackPublishOptions {
  if (id === 'motion') {
    return {
      screenShareEncoding: { maxBitrate: 2_000_000, maxFramerate: 30 },
      screenShareSimulcastLayers: [ScreenSharePresets.h360fps15],
      degradationPreference: 'maintain-framerate',
    };
  }
  return {
    screenShareEncoding: { maxBitrate: 1_500_000, maxFramerate: 15 },
    screenShareSimulcastLayers: [ScreenSharePresets.h360fps3, ScreenSharePresets.h720fps5],
    degradationPreference: 'maintain-resolution',
  };
}

export function profileTargetLabel(profile: MediaProfile): string {
  if (profile.audioOnly) return 'camera disabled';
  return `${profile.width}×${profile.height} @ ${profile.fps}fps · ceiling ${formatBitrate(profile.maxBitrate)}`;
}

export function audioProfileTargetLabel(profile: AudioProfile): string {
  return `${formatBitrate(profile.preset.maxBitrate)} mono · RED on · DTX on`;
}

export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(bitsPerSecond % 1_000_000 === 0 ? 0 : 1)}Mbps`;
  return `${Math.round(bitsPerSecond / 1_000)}kbps`;
}
