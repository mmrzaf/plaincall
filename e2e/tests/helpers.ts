import { createHmac, randomBytes } from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const BASE = (process.env['PLAINCALL_URL'] ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
export const KEY = process.env['PLAINCALL_KEY'] ?? '';

export function randomRoom(): string {
  return `e2e-${randomBytes(4).toString('hex')}`;
}

export function needKey(): string {
  if (!KEY) throw new Error('Set PLAINCALL_KEY to a member key the server accepts.');
  return KEY;
}

/** Opens a browser context, granting media permissions where the browser supports it. */
export async function newUser(
  browser: Browser,
  options: { preferences?: Record<string, unknown>; mobile?: boolean; name?: string } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const name = browser.browserType().name();
  const context = await browser.newContext({
    baseURL: BASE,
    ...(name === 'chromium' ? { permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] } : {}),
    ...(options.mobile ? { viewport: { width: 390, height: 780 }, isMobile: name !== 'firefox', hasTouch: true } : {}),
  });
  if (options.preferences) {
    await context.addInitScript((prefs) => {
      if (!localStorage.getItem('plaincall.preferences')) {
        localStorage.setItem('plaincall.preferences', JSON.stringify(prefs));
      }
    }, options.preferences);
  }
  // Remember every peer connection, so tests can read what is really sent.
  await context.addInitScript(() => {
    const w = window as unknown as { __pcs: RTCPeerConnection[] };
    w.__pcs = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = function (this: unknown, ...args: ConstructorParameters<typeof RTCPeerConnection>) {
      const pc = new Original(...args);
      w.__pcs.push(pc);
      return pc;
    } as unknown as typeof RTCPeerConnection;
    window.RTCPeerConnection.prototype = Original.prototype;
  });
  const page = await context.newPage();
  return { context, page };
}

export const noMedia = { micOn: false, cameraOn: false, mirror: true };

export async function openLobby(page: Page, room: string, name: string): Promise<void> {
  await page.goto(`/${room}`);
  await page.getByPlaceholder('Your name').fill(name);
}

export async function useKey(page: Page, key: string): Promise<void> {
  await page.locator('summary', { hasText: 'I have a host key' }).click();
  await page.getByPlaceholder('Host key').fill(key);
}

export const tiles = (page: Page) => page.locator('.grid .participant-tile');
export const tile = (page: Page, name: string) => tiles(page).filter({ hasText: name });

/** Joins and waits until the call shows `count` tiles. */
export async function joinCall(
  page: Page,
  room: string,
  name: string,
  options: { key?: string; count?: number; quality?: string } = {},
): Promise<void> {
  await openLobby(page, room, name);
  if (options.key) await useKey(page, options.key);
  if (options.quality) await page.getByLabel('Room style').selectOption(options.quality);
  await page.getByRole('button', { name: 'Join call' }).click();
  await expect(tiles(page)).toHaveCount(options.count ?? 1);
}

/** Waits until a tile shows a live video with picture. */
export async function expectVideo(page: Page, selector: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.locator(selector).evaluateAll((videos) =>
          videos.some((v) => (v as HTMLVideoElement).videoWidth > 0 && (v as HTMLVideoElement).readyState >= 2),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

export const remoteVideo = (name: string) => `.grid .participant-tile:has(.tile-name:text-is("${name}")) .has-video video`;

export async function openPeople(page: Page): Promise<void> {
  if (!(await page.locator('aside[aria-label="People"]').isVisible())) {
    await page.getByRole('button', { name: 'People' }).click();
  }
  await expect(page.locator('aside[aria-label="People"]')).toBeVisible();
}

export async function openSettings(page: Page): Promise<void> {
  if (!(await page.locator('aside[aria-label="Settings"]').isVisible())) {
    await page.getByRole('button', { name: 'Settings' }).click();
  }
  await expect(page.locator('aside[aria-label="Settings"]')).toBeVisible();
}

export interface VideoSender {
  /** One entry per published layer, highest quality last. */
  layers: { rid?: string; maxBitrate?: number; maxFramerate?: number }[];
  screen: boolean;
}

/** What this page is really sending: each video sender's layers. */
export async function videoSenders(page: Page): Promise<VideoSender[]> {
  return page.evaluate(() => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
    const out: VideoSender[] = [];
    for (const pc of pcs) {
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue;
        const encodings = sender.getParameters().encodings ?? [];
        out.push({
          layers: encodings.map((e) => ({ rid: e.rid, maxBitrate: e.maxBitrate, maxFramerate: e.maxFramerate })),
          screen: sender.track.contentHint === 'text' || sender.track.contentHint === 'motion' || sender.track.contentHint === 'detail',
        });
      }
    }
    return out;
  });
}

/** Picture sizes this page is receiving, one per incoming video. */
export async function receivedFrames(page: Page): Promise<{ width: number; fps: number }[]> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
    const out: { width: number; fps: number }[] = [];
    for (const pc of pcs) {
      (await pc.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video' && r.frameWidth) out.push({ width: r.frameWidth, fps: r.framesPerSecond ?? 0 });
      });
    }
    return out;
  });
}

// ---- LiveKit cleanup --------------------------------------------------------

function adminToken(): string {
  const key = process.env['LIVEKIT_API_KEY'] ?? '';
  const secret = process.env['LIVEKIT_API_SECRET'] ?? '';
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: key, nbf: now - 10, exp: now + 60, video: { roomList: true, roomCreate: true, roomAdmin: true } })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

async function roomService(method: string, body: unknown): Promise<any> {
  const api = (process.env['LIVEKIT_API_URL'] ?? '').replace(/\/+$/, '');
  const res = await fetch(`${api}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status}`);
  return res.json();
}

/** Deletes every room whose name starts with "e2e-". Nothing else is touched. */
export async function deleteTestRooms(): Promise<number> {
  if (!process.env['LIVEKIT_API_URL'] || !process.env['LIVEKIT_API_KEY']) return 0;
  const { rooms = [] } = await roomService('ListRooms', {});
  let deleted = 0;
  for (const room of rooms as { name: string }[]) {
    if (!room.name.startsWith('e2e-')) continue;
    await roomService('DeleteRoom', { room: room.name });
    deleted++;
  }
  return deleted;
}
