import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { needKey, noMedia, openLobby, randomRoom, useKey } from './helpers';

// Two instances of PlainCall, each with part of the call server out of reach.
const NO_API = 18081; // the room service is down
const NO_MEDIA = 18083; // the room service works but browsers cannot reach the media address
const children: ChildProcess[] = [];

async function start(port: number, env: Record<string, string>): Promise<void> {
  const bin = process.env['PLAINCALL_BIN'] ?? resolve(import.meta.dirname, '../../bin/plaincall');
  children.push(
    spawn(bin, [], {
      env: { ...process.env, PLAINCALL_ADDR: `127.0.0.1:${port}`, PLAINCALL_KEYS: `dead:${needKey()}`, ...env },
      stdio: 'ignore',
    }),
  );
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`PlainCall on port ${port} did not start.`);
}

test.beforeAll(async () => {
  // Nothing listens on port 9.
  await start(NO_API, { LIVEKIT_URL: 'ws://127.0.0.1:9', LIVEKIT_API_URL: 'http://127.0.0.1:9' });
  await start(NO_MEDIA, { LIVEKIT_URL: 'ws://127.0.0.1:9' });
});

test.afterAll(() => {
  for (const child of children) child.kill();
});

async function lobbyOn(browser: import('@playwright/test').Browser, port: number, name: string, key?: string) {
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${port}`, permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  await page.addInitScript((p) => localStorage.setItem('plaincall.preferences', JSON.stringify(p)), noMedia);
  await openLobby(page, randomRoom(), name);
  if (key) await useKey(page, key);
  await page.getByRole('button', { name: 'Join call' }).click();
  return { context, page };
}

test('with the room service down, guests and hosts are told the server is not responding', async ({ browser }) => {
  const guest = await lobbyOn(browser, NO_API, 'Gus');
  await expect(guest.page.getByRole('status').first()).toContainText('The call server is not responding');
  const host = await lobbyOn(browser, NO_API, 'Hal', needKey());
  await expect(host.page.getByRole('status').first()).toContainText('The call server is not responding');
  await guest.context.close();
  await host.context.close();
});

test('when the media address cannot be reached, a host sees that the call could not be joined', async ({ browser }) => {
  const host = await lobbyOn(browser, NO_MEDIA, 'Hal', needKey());
  await expect(host.page.getByRole('heading', { name: 'Could not join the call' })).toBeVisible({ timeout: 60_000 });
  await host.context.close();
});
