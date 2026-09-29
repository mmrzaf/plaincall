import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { joinCall, needKey, newUser, noMedia, openLobby, randomRoom, useKey } from './helpers';

const PORT = 18082;
let limited: ChildProcess | undefined;

test.beforeAll(async () => {
  const api = process.env['LIVEKIT_API_URL'] ?? '';
  const bin = process.env['PLAINCALL_BIN'] ?? resolve(import.meta.dirname, '../../bin/plaincall');
  limited = spawn(bin, [], {
    env: {
      ...process.env,
      PLAINCALL_ADDR: `127.0.0.1:${PORT}`,
      PLAINCALL_KEYS: `limit:${needKey()}`,
      PLAINCALL_MAX_PARTICIPANTS: '2',
      LIVEKIT_URL: process.env['LIVEKIT_URL'] ?? api.replace(/^http/, 'ws'),
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
  throw new Error('The limited PlainCall instance did not start.');
});

test.afterAll(() => {
  limited?.kill();
});

test('a full room says so, and frees a place when someone leaves', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const open = (name: string) =>
    browser.newContext({ baseURL: `http://127.0.0.1:${PORT}`, permissions: ['camera', 'microphone'] }).then(async (context) => {
      await context.addInitScript((p) => localStorage.setItem('plaincall.preferences', JSON.stringify(p)), noMedia);
      return { context, page: await context.newPage(), name };
    });

  const host = await open('Hal');
  const guest = await open('Gus');
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });

  // A third guest is turned away with a clear message.
  const third = await open('Tia');
  await openLobby(third.page, room, 'Tia');
  await third.page.getByRole('button', { name: 'Join call' }).click();
  await expect(third.page.getByRole('status').first()).toContainText('This room is full');

  // So is a second host.
  const other = await open('Sam');
  await openLobby(other.page, room, 'Sam');
  await useKey(other.page, key);
  await other.page.getByRole('button', { name: 'Join call' }).click();
  await expect(other.page.getByRole('status').first()).toContainText('This room is full');

  // When the guest leaves, the waiting guest can join.
  await guest.page.getByRole('button', { name: 'Leave' }).click();
  await expect(guest.page.getByRole('heading', { name: 'You left the call' })).toBeVisible();
  await third.page.getByRole('button', { name: 'Join call' }).click();
  await expect(third.page.locator('.grid .participant-tile')).toHaveCount(2);

  for (const u of [host, guest, third, other]) await u.context.close();
});
