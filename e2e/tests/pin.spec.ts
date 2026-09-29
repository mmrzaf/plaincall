import { expect, test } from '@playwright/test';
import { joinCall, needKey, newUser, noMedia, randomRoom, tile, tiles } from './helpers';

test('pinning shows one person large for the viewer who pinned them', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser, { preferences: noMedia });
  const gus = await newUser(browser, { preferences: noMedia });
  const olu = await newUser(browser, { preferences: noMedia });
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(gus.page, room, 'Gus', { count: 2 });
  await joinCall(olu.page, room, 'Olu', { count: 3 });

  const large = host.page.locator('.screen-tile.pinned-tile');
  await expect(large).toHaveCount(0);

  // Pin Gus: he appears large, and everyone still has a tile in the grid.
  await tile(host.page, 'Gus').hover();
  await host.page.getByRole('button', { name: 'Pin Gus' }).click();
  await expect(large).toHaveCount(1);
  await expect(large.locator('.tile-name')).toHaveText('Gus');
  await expect(host.page.locator('.stage.sharing')).toHaveCount(1);
  await expect(tiles(host.page)).toHaveCount(3);
  await expect(tile(host.page, 'Gus')).toHaveClass(/pinned/);

  // It is only for the person who pinned.
  await expect(gus.page.locator('.screen-tile.pinned-tile')).toHaveCount(0);
  await expect(olu.page.locator('.stage.sharing')).toHaveCount(0);

  // Pinning someone else moves it, and the same button unpins.
  await tile(host.page, 'Olu').hover();
  await host.page.getByRole('button', { name: 'Pin Olu' }).click();
  await expect(large).toHaveCount(1);
  await expect(large.locator('.tile-name')).toHaveText('Olu');
  await large.hover();
  await large.getByRole('button', { name: 'Unpin Olu' }).click();
  await expect(large).toHaveCount(0);
  await expect(host.page.locator('.stage.sharing')).toHaveCount(0);

  // If the pinned person leaves, the pin goes away.
  await tile(host.page, 'Gus').hover();
  await host.page.getByRole('button', { name: 'Pin Gus' }).click();
  await expect(large).toHaveCount(1);
  await gus.page.getByRole('button', { name: 'Leave' }).click();
  await expect(tiles(host.page)).toHaveCount(2);
  await expect(large).toHaveCount(0);

  for (const u of [host, gus, olu]) await u.context.close();
});
