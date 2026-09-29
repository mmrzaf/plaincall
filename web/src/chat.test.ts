import { describe, expect, it } from 'vitest';
import { MAX_CHAT_LENGTH, MAX_KEPT, SendLimiter, cleanChatText, decodeChat, encodeChat, keep, type ChatMessage } from './chat';

describe('chat text', () => {
  it('trims and tidies what people type', () => {
    expect(cleanChatText('  hello   there  ')).toBe('hello there');
    expect(cleanChatText('a\r\nb')).toBe('a\nb');
    expect(cleanChatText('a\n\n\n\nb')).toBe('a\n\nb');
    expect(cleanChatText('   \n  ')).toBeNull();
    expect(cleanChatText('')).toBeNull();
  });

  it('cuts long messages', () => {
    expect(cleanChatText('x'.repeat(MAX_CHAT_LENGTH + 50))).toHaveLength(MAX_CHAT_LENGTH);
  });

  it('round-trips text, including other scripts and emoji', () => {
    for (const text of ['hi', 'سلام دنیا', '山田さん', 'ok 👍']) {
      expect(decodeChat(encodeChat(text))).toBe(text);
    }
  });

  it('ignores anything that is not a chat message', () => {
    const bytes = (s: string) => new TextEncoder().encode(s);
    expect(decodeChat(bytes('not json'))).toBeNull();
    expect(decodeChat(bytes('null'))).toBeNull();
    expect(decodeChat(bytes('[]'))).toBeNull();
    expect(decodeChat(bytes('{"text":42}'))).toBeNull();
    expect(decodeChat(bytes('{"text":"   "}'))).toBeNull();
    expect(decodeChat(bytes('{"other":"x"}'))).toBeNull();
    expect(decodeChat(new Uint8Array(MAX_CHAT_LENGTH * 4 + 100))).toBeNull();
  });

  it('does not treat markup as anything but text', () => {
    expect(decodeChat(encodeChat('<img src=x onerror=alert(1)>'))).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('send limit', () => {
  it('allows a burst, then waits for the window to pass', () => {
    let now = 0;
    const limiter = new SendLimiter(() => now, 3, 1000);
    expect([limiter.allow(), limiter.allow(), limiter.allow(), limiter.allow()]).toEqual([true, true, true, false]);
    now = 999;
    expect(limiter.allow()).toBe(false);
    now = 1000;
    expect(limiter.allow()).toBe(true);
  });
});

describe('kept messages', () => {
  const message = (id: number): ChatMessage => ({ id, from: 'p_1', name: 'Ada', text: String(id), at: new Date(0), mine: false });

  it('drops the oldest beyond the limit', () => {
    let kept: ChatMessage[] = [];
    for (let i = 0; i < MAX_KEPT + 5; i++) kept = keep(kept, message(i));
    expect(kept).toHaveLength(MAX_KEPT);
    expect(kept[0]?.id).toBe(5);
    expect(kept.at(-1)?.id).toBe(MAX_KEPT + 4);
  });
});
