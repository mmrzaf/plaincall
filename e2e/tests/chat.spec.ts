import { expect, test } from '@playwright/test';
import { joinCall, needKey, newUser, noMedia, randomRoom } from './helpers';

const chatPanel = (page: import('@playwright/test').Page) => page.locator('aside[aria-label="Chat"]');

test('chat reaches everyone, shows who sent it, and counts unread messages', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser, { preferences: noMedia });
  const guest = await newUser(browser, { preferences: noMedia });
  const late = await newUser(browser, { preferences: noMedia });
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });

  // The guest sends while the host's chat is closed: the host sees an unread count.
  await guest.page.getByRole('button', { name: 'Chat' }).click();
  await expect(chatPanel(guest.page)).toBeVisible();
  await guest.page.getByLabel('Message', { exact: true }).fill('  hello   host  ');
  await guest.page.getByLabel('Message', { exact: true }).press('Enter');
  await expect(chatPanel(guest.page).locator('.chat-message.mine .chat-text')).toHaveText('hello host');
  await expect(host.page.getByRole('button', { name: 'Chat' }).locator('.count')).toHaveText('1');

  // Opening the chat shows the message with the sender's name and clears the count.
  await host.page.getByRole('button', { name: 'Chat' }).click();
  const received = chatPanel(host.page).locator('.chat-message');
  await expect(received).toHaveCount(1);
  await expect(received.locator('.chat-name')).toHaveText('Gus');
  await expect(received.locator('.chat-text')).toHaveText('hello host');
  await expect(host.page.getByRole('button', { name: 'Chat' }).locator('.count')).toHaveCount(0);

  // A reply, with a second line, and text that looks like markup stays text.
  await host.page.getByLabel('Message', { exact: true }).fill('<b>hi</b>');
  await host.page.getByLabel('Message', { exact: true }).press('Shift+Enter');
  await host.page.getByLabel('Message', { exact: true }).type('second line');
  await host.page.getByRole('button', { name: 'Send' }).click();
  await expect(chatPanel(guest.page).locator('.chat-message').last().locator('.chat-text')).toHaveText('<b>hi</b>\nsecond line');
  await expect(chatPanel(guest.page).locator('.chat-message b')).toHaveCount(0);

  // Someone who joins later sees no earlier messages.
  await joinCall(late.page, room, 'Lee', { count: 3 });
  await late.page.getByRole('button', { name: 'Chat' }).click();
  await expect(chatPanel(late.page).locator('.chat-message')).toHaveCount(0);
  await expect(chatPanel(late.page)).toContainText('No messages yet');
  await late.page.getByLabel('Message', { exact: true }).fill('hello all');
  await late.page.getByRole('button', { name: 'Send' }).click();
  await expect(chatPanel(host.page).locator('.chat-message').last().locator('.chat-text')).toHaveText('hello all');

  // Only one panel is open at a time.
  await host.page.getByRole('button', { name: 'People' }).click();
  await expect(chatPanel(host.page)).toBeHidden();

  for (const u of [host, guest, late]) await u.context.close();
});

test('sending too fast is slowed down and the message is kept', async ({ browser }) => {
  const key = needKey();
  const room = randomRoom();
  const host = await newUser(browser, { preferences: noMedia });
  const guest = await newUser(browser, { preferences: noMedia });
  await joinCall(host.page, room, 'Hal', { key });
  await joinCall(guest.page, room, 'Gus', { count: 2 });
  await host.page.getByRole('button', { name: 'Chat' }).click();
  await guest.page.getByRole('button', { name: 'Chat' }).click();

  const input = guest.page.getByLabel('Message', { exact: true });
  for (let i = 1; i <= 7; i++) {
    await input.fill(`msg ${i}`);
    await input.press('Enter');
  }
  await expect(guest.page.locator('.toast')).toContainText('too fast');
  await expect(chatPanel(host.page).locator('.chat-message .chat-text')).toHaveText(['msg 1', 'msg 2', 'msg 3', 'msg 4', 'msg 5']);
  // Refused messages stay in the box, so nothing typed is lost.
  await expect(input).toHaveValue('msg 7');
  for (const u of [host, guest]) await u.context.close();
});
