import { expect, test } from '@playwright/test';
import {
  expectVideo,
  joinCall,
  needKey,
  newUser,
  openLobby,
  openPeople,
  randomRoom,
  remoteVideo,
  tile,
  tiles,
  useKey,
} from './helpers';

test('a waiting guest is admitted when the host arrives @firefox', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const guest = await newUser(browser);
  const host = await newUser(browser);

  await openLobby(guest.page, room, 'Gus');
  await guest.page.getByRole('button', { name: 'Join call' }).click();
  await expect(guest.page.getByText('Waiting for the host to arrive')).toBeVisible();

  await joinCall(host.page, room, 'Hal', { key });
  await expect(tiles(guest.page)).toHaveCount(2, { timeout: 15_000 });
  await expect(tiles(host.page)).toHaveCount(2);

  // media flows and the Host badge marks only the host.
  await expectVideo(guest.page, remoteVideo('Hal'));
  await expectVideo(host.page, remoteVideo('Gus'));
  await expect.poll(() => guest.page.locator('audio').count()).toBeGreaterThan(0);
  await expect(tile(guest.page, 'Hal').locator('.badge[title="Host"]')).toHaveCount(1);
  await expect(tile(guest.page, 'Gus').locator('.badge[title="Host"]')).toHaveCount(0);
  await expect(tile(host.page, 'Hal').locator('.badge[title="Host"]')).toHaveCount(1);
  await expect(tile(host.page, 'Gus').locator('.badge[title="Host"]')).toHaveCount(0);

  await guest.context.close();
  await host.context.close();
});

test('mute and camera state reach other people @firefox', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser);
  const guest = await newUser(browser);
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });
  await expect(tiles(host.page)).toHaveCount(2);
  await expectVideo(host.page, remoteVideo('Gus'));

  const gusOnHost = tile(host.page, 'Gus');
  await guest.page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(gusOnHost.locator('.badge[title="Muted"]')).toHaveCount(1);
  await guest.page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect(gusOnHost.locator('.badge[title="Muted"]')).toHaveCount(0);

  await guest.page.getByRole('button', { name: 'Stop video' }).click();
  await expect(gusOnHost.locator('.has-video')).toHaveCount(0);
  await expect(gusOnHost.locator('.avatar')).toBeVisible();
  await guest.page.getByRole('button', { name: 'Start video' }).click();
  await expectVideo(host.page, remoteVideo('Gus'));

  await guest.context.close();
  await host.context.close();
});

test('host controls, lock, and removal @firefox', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser);
  const guest = await newUser(browser);
  const other = await newUser(browser);
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });
  await joinCall(other.page, room, 'Olu', { count: 3 });

  // guests get no moderation controls, the host does.
  await openPeople(guest.page);
  await expect(guest.page.locator('aside[aria-label="People"] .person')).toHaveCount(3);
  await expect(guest.page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(guest.page.getByRole('button', { name: /Lock room|Unlock room/ })).toHaveCount(0);
  await expect(guest.page.getByRole('button', { name: 'End call for everyone' })).toHaveCount(0);
  await openPeople(host.page);
  await expect(host.page.getByRole('button', { name: /^Remove / })).toHaveCount(2);
  await expect(host.page.getByRole('button', { name: 'Lock room' })).toBeVisible();

  // locking shows a chip to everyone and refuses new guests until unlocked.
  await host.page.getByRole('button', { name: 'Lock room' }).click();
  for (const p of [host.page, guest.page, other.page]) {
    await expect(p.locator('.chip.warn', { hasText: 'Locked' })).toBeVisible();
  }
  const late = await newUser(browser);
  await openLobby(late.page, room, 'Late');
  await late.page.getByRole('button', { name: 'Join call' }).click();
  await expect(late.page.getByRole('status').first()).toContainText('locked');
  await host.page.getByRole('button', { name: 'Unlock room' }).click();
  await expect(host.page.locator('.chip.warn', { hasText: 'Locked' })).toBeHidden();
  await expect(guest.page.locator('.chip.warn', { hasText: 'Locked' })).toBeHidden();
  await late.page.getByRole('button', { name: 'Join call' }).click();
  await expect(tiles(late.page)).toHaveCount(4);

  // removing a guest disconnects them and updates everyone else's tiles.
  await host.page.getByRole('button', { name: 'Remove Gus' }).click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(guest.page.getByRole('heading', { name: 'You were removed' })).toBeVisible();
  await expect(tiles(host.page)).toHaveCount(3);
  await expect(tiles(other.page)).toHaveCount(3);
  await expect(tiles(late.page)).toHaveCount(3);

  for (const u of [host, guest, other, late]) await u.context.close();
});
