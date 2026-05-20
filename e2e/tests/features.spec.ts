import { expect, test } from '@playwright/test';
import {
  expectVideo,
  joinCall,
  needKey,
  newUser,
  noMedia,
  openLobby,
  openPeople,
  openSettings,
  randomRoom,
  remoteVideo,
  tile,
  tiles,
  useKey,
} from './helpers';

test('a screen share reaches other people and stopping it clears the stage', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser);
  const guest = await newUser(browser);
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });
  await expect(tiles(host.page)).toHaveCount(2);

  await guest.page.getByRole('button', { name: 'Share' }).click();
  await expectVideo(host.page, '.screen-tile video');
  await expect(host.page.locator('.screen-tile')).toHaveCount(1);
  await guest.page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(host.page.locator('.screen-tile')).toHaveCount(0);
  await expect(host.page.locator('.stage.sharing')).toHaveCount(0);

  await guest.context.close();
  await host.context.close();
});

test('ending the call disconnects everyone and guests wait again', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser);
  const guest = await newUser(browser);
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });

  await openPeople(host.page);
  await host.page.getByRole('button', { name: 'End call for everyone' }).click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'End call' }).click();
  await expect(host.page.getByRole('heading', { name: 'The call has ended' })).toBeVisible();
  await expect(guest.page.getByRole('heading', { name: 'The call has ended' })).toBeVisible();

  const late = await newUser(browser);
  await openLobby(late.page, room, 'Late');
  await late.page.getByRole('button', { name: 'Join call' }).click();
  await expect(late.page.getByText('Waiting for the host to arrive')).toBeVisible();

  for (const u of [host, guest, late]) await u.context.close();
});

test('audio only stops video both ways and keeps audio', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser);
  const guest = await newUser(browser);
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });
  await expectVideo(guest.page, remoteVideo('Hal'));
  await expect.poll(() => guest.page.locator('audio').count()).toBeGreaterThan(0);

  await openSettings(guest.page);
  await guest.page.getByLabel('Audio only').check();
  await expect(tile(host.page, 'Gus').locator('.has-video')).toHaveCount(0);
  await expect(tile(guest.page, 'Hal').locator('.has-video')).toHaveCount(0);
  await expect(guest.page.getByRole('button', { name: 'Start video' })).toBeDisabled();
  await expect(guest.page.locator('.chip', { hasText: 'Audio only' })).toBeVisible();
  expect(await guest.page.locator('audio').count()).toBeGreaterThan(0);

  await guest.page.getByLabel('Audio only').uncheck();
  await expectVideo(guest.page, remoteVideo('Hal'));
  await expect(guest.page.getByRole('button', { name: 'Start video' })).toBeEnabled();

  await guest.context.close();
  await host.context.close();
});

test('host key handling', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const { context, page } = await newUser(browser, { preferences: noMedia });

  await openLobby(page, room, 'Hal');
  await useKey(page, 'definitely-the-wrong-key-1234');
  await page.getByRole('button', { name: 'Join call' }).click();
  await expect(page.getByRole('status').first()).toContainText('not valid');
  await expect(page.getByPlaceholder('Host key')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('plaincall.key'))).toBeNull();

  await page.getByPlaceholder('Host key').fill(key);
  await page.getByRole('button', { name: 'Join call' }).click();
  await expect(tiles(page)).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('plaincall.key'))).toBe(key);

  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'You left the call' })).toBeVisible();
  await page.getByRole('button', { name: 'Rejoin' }).click();
  await expect(page.getByText('You will join as a host.')).toBeVisible();
  await page.getByRole('button', { name: 'Forget key' }).click();
  expect(await page.evaluate(() => localStorage.getItem('plaincall.key'))).toBeNull();
  await expect(page.locator('summary', { hasText: 'I have a host key' })).toBeVisible();
  await context.close();
});

test('leaving while still connecting ends cleanly', async ({ browser }) => {
  const key = needKey();
  const { context, page } = await newUser(browser, { preferences: noMedia });
  // Press Leave in the same task that first draws the call, before it can connect.
  await page.addInitScript(() => {
    const watch = new MutationObserver(() => {
      const leave = document.querySelector<HTMLButtonElement>('.controls .leave');
      if (leave) {
        watch.disconnect();
        leave.click();
      }
    });
    document.addEventListener('DOMContentLoaded', () => watch.observe(document.body, { childList: true, subtree: true }));
  });
  await openLobby(page, randomRoom(), 'Hal');
  await useKey(page, key);
  await page.getByRole('button', { name: 'Join call' }).click();
  await expect(page.getByRole('heading', { name: 'You left the call' })).toBeVisible();
  await context.close();
});

test('a network drop shows Reconnecting and recovers', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser);
  const guest = await newUser(browser);
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });

  await guest.context.setOffline(true);
  await expect(guest.page.locator('.banner', { hasText: 'Reconnecting' })).toBeVisible({ timeout: 40_000 });
  await guest.context.setOffline(false);
  await expect(guest.page.locator('.banner', { hasText: 'Reconnecting' })).toBeHidden({ timeout: 60_000 });
  await expect(tiles(guest.page)).toHaveCount(2);
  await expect(tiles(host.page)).toHaveCount(2);

  await guest.context.close();
  await host.context.close();
});

test('six participants share a grid and a share adds a rail', async ({ browser }) => {
  test.setTimeout(180_000);
  const key = needKey();
  const room = randomRoom();
  const users = [];
  const host = await newUser(browser, { preferences: noMedia });
  users.push(host);
  await joinCall(host.page, room, 'Hal', { key });
  for (let i = 1; i < 6; i++) {
    const u = await newUser(browser, { preferences: i === 1 ? { ...noMedia, cameraOn: true } : noMedia });
    users.push(u);
    await joinCall(u.page, room, `User ${i}`, { count: i + 1 });
  }
  await expect(tiles(host.page)).toHaveCount(6);

  const check = async (phase: string) => {
    const boxes = await host.page.locator('.grid .participant-tile').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), l: r.left, t: r.top, r: r.right, b: r.bottom };
      }),
    );
    const grid = await host.page.locator('.grid').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
    for (const box of boxes) {
      expect(Math.abs(box.w - boxes[0]!.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.h - boxes[0]!.h)).toBeLessThanOrEqual(1);
      expect(box.l).toBeGreaterThanOrEqual(grid.l - 1);
      expect(box.r).toBeLessThanOrEqual(grid.r + 1);
      // The rail scrolls inside itself, so only the plain grid must fit whole.
      if (phase === 'grid') {
        expect(box.t).toBeGreaterThanOrEqual(grid.t - 1);
        expect(box.b).toBeLessThanOrEqual(grid.b + 1);
      }
    }
    const overflow = await host.page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    expect(overflow.y).toBeLessThanOrEqual(0);
  };
  await check("grid");

  await users[1]!.page.getByRole('button', { name: 'Share' }).click();
  await expectVideo(host.page, '.screen-tile video');
  await expect(host.page.locator('.stage.sharing')).toHaveCount(1);
  await expect(tiles(host.page)).toHaveCount(6);
  await check("share");
  const rail = await host.page.locator('.grid').evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));
  expect(rail.w).toBeLessThan(300);
  expect(rail.h).toBeGreaterThan(rail.w);

  for (const u of users) await u.context.close();
});

test('phone layout shows panels as sheets, one at a time', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser, { preferences: noMedia });
  await joinCall(host.page, room, 'Hal', { key });
  const phone = await newUser(browser, { mobile: true });
  await joinCall(phone.page, room, 'Pia', { count: 2 });

  await phone.page.getByRole('button', { name: 'Settings' }).tap();
  await expect(phone.page.locator('aside[aria-label="Settings"]')).toBeVisible();
  const sheet = await phone.page.locator('aside[aria-label="Settings"]').boundingBox();
  expect(sheet!.width).toBeGreaterThan(300);
  await phone.page.getByRole('button', { name: 'People' }).tap();
  await expect(phone.page.locator('aside[aria-label="People"]')).toBeVisible();
  await expect(phone.page.locator('aside[aria-label="Settings"]')).toBeHidden();
  expect(await phone.page.locator('aside.panel:not([hidden])').count()).toBe(1);
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await host.context.close();
  await phone.context.close();
});

test('copy link puts the room address on the clipboard', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const { context, page } = await newUser(browser, { preferences: noMedia });
  await joinCall(page, room, 'Hal', { key });
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.locator('.toast')).toContainText('Link copied');
  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/${room}`);
  await context.close();
});

test('nothing the user sees names the media server', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const { context, page } = await newUser(browser, { preferences: noMedia });
  const console: string[] = [];
  const scripts: string[] = [];
  page.on('console', (message) => console.push(message.text()));
  page.on('request', (request) => scripts.push(request.url()));

  const visible = async () =>
    page.evaluate(() => `${document.body.innerText}\n${document.documentElement.outerHTML}\n${document.title}`);
  const seen: string[] = [];

  await page.goto('/');
  seen.push(await visible());
  await joinCall(page, room, 'Hal', { key });
  await openPeople(page);
  seen.push(await visible());
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'You left the call' })).toBeVisible();
  seen.push(await visible());

  for (const text of seen) expect(text).not.toMatch(/livekit/i);
  expect(console.join('\n')).not.toMatch(/livekit/i);
  const appOrigin = new URL(page.url()).origin;
  for (const url of scripts.filter((u) => u.startsWith(appOrigin))) expect(url).not.toMatch(/livekit/i);
  await context.close();
});
