import { expect, test } from '@playwright/test';
import { BASE, newUser, randomRoom, openLobby } from './helpers';

test('landing rejects short names and normalizes long ones @firefox @webkit', async ({ browser }) => {
  const { context, page } = await newUser(browser);
  await page.goto('/');
  const input = page.getByLabel('Room name');
  await input.fill('ab');
  await input.press('Enter');
  await expect(page.getByRole('status').first()).toContainText('3 to 48');
  await expect(page).toHaveURL(`${BASE}/`);
  await input.fill('Team-Standup');
  await input.press('Enter');
  await expect(page).toHaveURL(`${BASE}/team-standup`);
  await context.close();
});

test('lobby shows a preview and fills the device lists @firefox', async ({ browser }) => {
  const { context, page } = await newUser(browser);
  await openLobby(page, randomRoom(), 'Ann');
  await expect
    .poll(() => page.locator('.preview video').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  for (const label of ['Microphone', 'Camera']) {
    await expect
      .poll(() => page.locator(`select[aria-label="${label}"]`).locator('option').count(), { message: `${label} options` })
      .toBeGreaterThan(0);
  }
  if (browser.browserType().name() === 'chromium') {
    await expect.poll(() => page.locator('select[aria-label="Speaker"]').locator('option').count()).toBeGreaterThan(0);
  }
  await context.close();
});

test('load: the app loads and the lobby renders @webkit @webkit-only', async ({ browser }) => {
  const { context, page } = await newUser(browser);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'PlainCall' })).toBeVisible();
  await page.goto(`/${randomRoom()}`);
  await expect(page.getByRole('button', { name: 'Join call' })).toBeVisible();
  await expect(page.getByPlaceholder('Your name')).toBeVisible();
  await context.close();
});

test('an invalid room path returns to the start page with an error', async ({ browser }) => {
  const { context, page } = await newUser(browser);
  await page.goto('/a_b');
  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByRole('status').first()).toContainText('not a valid room name');
  await context.close();
});
