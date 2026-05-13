import { describe, expect, it } from 'vitest';
import { normalizeRoom, randomRoomName, roomFromPath } from './rooms';

describe('normalizeRoom', () => {
  it('accepts valid names and lower-cases them', () => {
    expect(normalizeRoom('standup')).toBe('standup');
    expect(normalizeRoom('  StandUp ')).toBe('standup');
    expect(normalizeRoom('kfj-2hd-9xq')).toBe('kfj-2hd-9xq');
    expect(normalizeRoom('a'.repeat(48))).toBe('a'.repeat(48));
  });

  it('rejects invalid names', () => {
    for (const bad of ['', 'ab', 'abc-', '-abc', 'a--b', 'ab_c', 'ab c', 'ab.c', 'a/b/c', 'é-é-é', 'a'.repeat(49)]) {
      expect(normalizeRoom(bad), bad).toBeNull();
    }
  });
});

describe('roomFromPath', () => {
  it('reads the room from the path', () => {
    expect(roomFromPath('/standup')).toBe('standup');
    expect(roomFromPath('/Standup/')).toBe('standup');
    expect(roomFromPath('/kfj-2hd-9xq')).toBe('kfj-2hd-9xq');
  });

  it('returns null for the home page and for anything else', () => {
    expect(roomFromPath('/')).toBeNull();
    expect(roomFromPath('')).toBeNull();
    expect(roomFromPath('/a/b')).toBeNull();
    expect(roomFromPath('/ab')).toBeNull();
    expect(roomFromPath('/%E0%A4%A')).toBeNull();
  });
});

describe('randomRoomName', () => {
  it('produces a valid name in the expected shape', () => {
    for (let i = 0; i < 50; i++) {
      const name = randomRoomName();
      expect(name).toMatch(/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/);
      expect(normalizeRoom(name)).toBe(name);
    }
  });

  it('skips bytes that would bias the choice', () => {
    // 255 is above the largest multiple of the alphabet size, so it is skipped.
    const calls: number[] = [];
    const name = randomRoomName((length) => {
      calls.push(length);
      return new Uint8Array(length).fill(calls.length === 1 ? 255 : 0);
    });
    expect(name).toBe('aaa-aaaa-aaa');
    expect(calls.length).toBeGreaterThan(1);
  });

  it('does not repeat', () => {
    const names = new Set(Array.from({ length: 200 }, () => randomRoomName()));
    expect(names.size).toBe(200);
  });
});
