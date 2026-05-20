import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { needKey, noMedia, openLobby, randomRoom, useKey } from './helpers';

const PORT = 18081;
let dead: ChildProcess | undefined;

test.beforeAll(async () => {
  const bin = process.env['PLAINCALL_BIN'] ?? resolve(import.meta.dirname, '../../bin/plaincall');
  dead = spawn(bin, [], {
    env: {
      ...process.env,
      PLAINCALL_ADDR: `127.0.0.1:${PORT}`,
      PLAINCALL_KEYS: `dead:${needKey()}`,
      // Nothing listens on port 9, so neither the API nor the media server answers.
      LIVEKIT_URL: 'ws://127.0.0.1:9',
      LIVEKIT_API_URL: 'http://127.0.0.1:9',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('The second PlainCall instance did not start.');
});

test.afterAll(() => {
  dead?.kill();
});

test('an unreachable call server gives clear messages', async ({ browser }) => {
  const base = `http://127.0.0.1:${PORT}`;
  const room = randomRoom();

  const guestCtx = await browser.newContext({ baseURL: base, permissions: ['camera', 'microphone'] });
  const guest = await guestCtx.newPage();
  await guest.addInitScript((p) => localStorage.setItem('plaincall.preferences', JSON.stringify(p)), noMedia);
  await openLobby(guest, room, 'Gus');
  await guest.getByRole('button', { name: 'Join call' }).click();
  await expect(guest.getByRole('status').first()).toContainText('The call server is not responding');

  const memberCtx = await browser.newContext({ baseURL: base, permissions: ['camera', 'microphone'] });
  const member = await memberCtx.newPage();
  await member.addInitScript((p) => localStorage.setItem('plaincall.preferences', JSON.stringify(p)), noMedia);
  await openLobby(member, room, 'Hal');
  await useKey(member, needKey());
  await member.getByRole('button', { name: 'Join call' }).click();
  await expect(member.getByRole('heading', { name: 'Could not join the call' })).toBeVisible({ timeout: 60_000 });

  await guestCtx.close();
  await memberCtx.close();
});
