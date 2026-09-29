import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY, QUALITIES, cameraCapture, cameraPublish, isQuality, screenShareSettings } from './quality';

describe('room presets', () => {
  it('lists every preset once, starting with the default', () => {
    expect(QUALITIES.map((q) => q.id)).toEqual(['presentation', 'meeting', 'low']);
    expect(QUALITIES[0]?.id).toBe(DEFAULT_QUALITY);
  });

  it('recognises only known presets', () => {
    expect(isQuality('low')).toBe(true);
    expect(isQuality('ultra')).toBe(false);
    expect(isQuality(undefined)).toBe(false);
  });

  it('publishes one full-size layer for slides, so viewers are never handed a half-size copy', () => {
    for (const q of ['presentation', 'low'] as const) {
      const { publish, capture } = screenShareSettings(q);
      expect(publish.simulcast).toBe(false);
      expect(capture.contentHint).toBe('text');
      expect(publish.degradationPreference).toBe('maintain-resolution');
    }
    expect(screenShareSettings('presentation').capture.resolution?.width).toBe(1920);
  });

  it('keeps slides at a low frame rate and motion at a high one', () => {
    const fps = (q: 'presentation' | 'meeting' | 'low') => screenShareSettings(q).capture.resolution?.frameRate ?? 0;
    expect(fps('presentation')).toBeLessThanOrEqual(10);
    expect(fps('low')).toBeLessThanOrEqual(fps('presentation'));
    expect(fps('meeting')).toBeGreaterThanOrEqual(24);
    expect(screenShareSettings('meeting').capture.contentHint).toBe('motion');
    expect(screenShareSettings('meeting').publish.degradationPreference).toBe('maintain-framerate');
  });

  it('caps the frame rate it captures at the frame rate it encodes', () => {
    for (const q of ['presentation', 'meeting', 'low'] as const) {
      const { capture, publish } = screenShareSettings(q);
      expect(publish.screenShareEncoding?.maxFramerate).toBe(capture.resolution?.frameRate);
    }
  });

  it('spends less as the preset gets lighter', () => {
    const share = (q: 'presentation' | 'meeting' | 'low') => screenShareSettings(q).publish.screenShareEncoding?.maxBitrate ?? 0;
    const camera = (q: 'presentation' | 'meeting' | 'low') => cameraPublish(q).videoEncoding?.maxBitrate ?? 0;
    expect(share('low')).toBeLessThan(share('presentation'));
    expect(share('presentation')).toBeLessThanOrEqual(share('meeting'));
    expect(camera('low')).toBeLessThan(camera('presentation'));
    expect(camera('presentation')).toBeLessThan(camera('meeting'));
    expect(cameraCapture('low').resolution?.height).toBe(360);
    expect(cameraCapture('meeting').resolution?.height).toBe(720);
  });
});
