import { expect, test } from '@playwright/test';
import { joinCall, needKey, newUser, openPeople, randomRoom, tile, tiles } from './helpers';

const micOnly = { micOn: true, cameraOn: false, mirror: true };

test('a host can mute one person or every guest', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser, { preferences: micOnly });
  const gus = await newUser(browser, { preferences: micOnly });
  const olu = await newUser(browser, { preferences: micOnly });
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(gus.page, room, 'Gus', { count: 2 });
  await joinCall(olu.page, room, 'Olu', { count: 3 });
  await openPeople(host.page);

  // Guests get no mute controls.
  await openPeople(gus.page);
  await expect(gus.page.getByRole('button', { name: /^Mute / })).toHaveCount(0);
  await expect(gus.page.getByRole('button', { name: 'Mute all guests' })).toHaveCount(0);

  // Mute one.
  await host.page.getByRole('button', { name: 'Mute Gus' }).click();
  await expect(gus.page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  await expect(tile(host.page, 'Gus').locator('.badge[title="Muted"]')).toHaveCount(1);
  await expect(tile(host.page, 'Olu').locator('.badge[title="Muted"]')).toHaveCount(0);
  await expect(host.page.getByRole('button', { name: 'Mute Gus' })).toHaveCount(0);

  // Muting is a request: the person can turn the microphone back on.
  await gus.page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect(tile(host.page, 'Gus').locator('.badge[title="Muted"]')).toHaveCount(0);

  // Mute every guest. The host stays unmuted.
  await host.page.getByRole('button', { name: 'Mute all guests' }).click();
  await expect(host.page.locator('.toast')).toContainText('2 guests were muted');
  for (const guest of [gus, olu]) {
    await expect(guest.page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  }
  await expect(host.page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
  await expect(tile(host.page, 'Hal').locator('.badge[title="Muted"]')).toHaveCount(0);

  // Nothing left to mute.
  await host.page.getByRole('button', { name: 'Mute all guests' }).click();
  await expect(host.page.locator('.toast')).toContainText('already muted');
  await expect(tiles(host.page)).toHaveCount(3);

  for (const u of [host, gus, olu]) await u.context.close();
});
