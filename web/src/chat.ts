// Chat travels as small data messages between the browsers in a room. Nothing
// is stored: people who join later do not see earlier messages.

export const CHAT_TOPIC = 'chat';
export const MAX_CHAT_LENGTH = 500;
/** How many messages a person can send in `RATE_WINDOW_MS`. */
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 5000;
/** Messages kept on screen. Older ones are dropped. */
export const MAX_KEPT = 200;

export interface ChatMessage {
  id: number;
  /** The sender's LiveKit identity, which the server sets and cannot be forged. */
  from: string;
  name: string;
  text: string;
  at: Date;
  mine: boolean;
}

/** Tidies text typed by a person. Returns null when there is nothing to send. */
export function cleanChatText(raw: string): string | null {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text === '' ? null : text.slice(0, MAX_CHAT_LENGTH);
}

export function encodeChat(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ text }));
}

/** Reads a received message. Anything malformed or oversized is ignored. */
export function decodeChat(payload: Uint8Array): string | null {
  if (payload.byteLength > MAX_CHAT_LENGTH * 4 + 64) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const text = (parsed as { text?: unknown }).text;
    return typeof text === 'string' ? cleanChatText(text) : null;
  } catch {
    return null;
  }
}

/** Allows a few messages in a short time, so nobody floods the room by accident. */
export class SendLimiter {
  private sent: number[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limit = RATE_LIMIT,
    private readonly windowMs = RATE_WINDOW_MS,
  ) {}

  /** Records a send and returns true, or returns false when the person is over the limit. */
  allow(): boolean {
    const now = this.now();
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    if (this.sent.length >= this.limit) return false;
    this.sent.push(now);
    return true;
  }
}

/** Adds a message and drops the oldest ones beyond `MAX_KEPT`. */
export function keep(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...messages, message];
  return next.length > MAX_KEPT ? next.slice(next.length - MAX_KEPT) : next;
}
