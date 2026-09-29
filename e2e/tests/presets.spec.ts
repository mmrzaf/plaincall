import { expect, test } from '@playwright/test';
import { expectVideo, joinCall, needKey, newUser, noMedia, randomRoom, receivedFrames, tiles, videoSenders } from './helpers';

// The screen share is the only video sender with a content hint set.
const screenSender = async (page: Parameters<typeof videoSenders>[0]) => (await videoSenders(page)).find((s) => s.screen);

test('a room starts with the presentation preset: one sharp layer at a low frame rate', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser, { preferences: noMedia });
  const guest = await newUser(browser, { preferences: { ...noMedia, cameraOn: true } });
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });
  await expect(guest.page.locator('.chip[title="Room style"]')).toHaveText('Presentation');

  await guest.page.getByRole('button', { name: 'Share' }).click();
  await expectVideo(host.page, '.screen-tile video');

  const share = await screenSender(guest.page);
  expect(share?.layers).toHaveLength(1);
  expect(share?.layers[0]).toMatchObject({ maxBitrate: 3_000_000, maxFramerate: 8 });
  expect(share?.layers[0]?.rid).toBeUndefined();

  // The viewer gets the full-size picture, not a half-size copy.
  await expect.poll(async () => Math.max(...(await receivedFrames(host.page)).map((f) => f.width))).toBeGreaterThanOrEqual(1900);

  // The camera is capped too.
  const camera = (await videoSenders(guest.page)).find((s) => !s.screen);
  expect(Math.max(...(camera?.layers.map((l) => l.maxBitrate ?? 0) ?? [0]))).toBeLessThanOrEqual(900_000);

  await host.context.close();
  await guest.context.close();
});

test('the first host decides the preset and it reaches everyone', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const first = await newUser(browser, { preferences: noMedia });
  const second = await newUser(browser, { preferences: noMedia });
  const guest = await newUser(browser, { preferences: { ...noMedia, cameraOn: true } });

  await joinCall(first.page, room, 'Hal', { key, quality: 'low' });
  // A second host asks for another style, but the room is already running.
  await joinCall(second.page, room, 'Sam', { key, quality: 'meeting', count: 2 });
  await joinCall(guest.page, room, 'Gus', { count: 3 });
  for (const u of [first, second, guest]) {
    await expect(u.page.locator('.chip[title="Room style"]')).toHaveText('Low bandwidth');
  }

  await guest.page.getByRole('button', { name: 'Share' }).click();
  await expectVideo(first.page, '.screen-tile video');
  const share = await screenSender(guest.page);
  expect(share?.layers).toHaveLength(1);
  expect(share?.layers[0]).toMatchObject({ maxBitrate: 1_000_000, maxFramerate: 5 });
  await expect.poll(async () => Math.max(...(await receivedFrames(first.page)).map((f) => f.width))).toBeLessThanOrEqual(1280);

  const camera = (await videoSenders(guest.page)).find((s) => !s.screen);
  expect(Math.max(...(camera?.layers.map((l) => l.maxBitrate ?? 0) ?? [0]))).toBeLessThanOrEqual(400_000);

  for (const u of [first, second, guest]) await u.context.close();
});

test('the meeting preset keeps smooth motion and lets viewers fall back', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser, { preferences: noMedia });
  const guest = await newUser(browser, { preferences: noMedia });
  await joinCall(host.page, room, 'Hal', { key, quality: 'meeting' });
  await joinCall(guest.page, room, 'Gus', { count: 2 });

  await guest.page.getByRole('button', { name: 'Share' }).click();
  await expectVideo(host.page, '.screen-tile video');
  const share = await screenSender(guest.page);
  expect(share?.layers.length).toBeGreaterThan(1);
  expect(Math.max(...(share?.layers.map((l) => l.maxFramerate ?? 0) ?? [0]))).toBe(30);
  expect(Math.max(...(share?.layers.map((l) => l.maxBitrate ?? 0) ?? [0]))).toBe(4_000_000);
  await expect(tiles(host.page)).toHaveCount(2);

  await host.context.close();
  await guest.context.close();
});
