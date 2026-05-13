// Room names are the path of the page's URL. These rules match the server's.

const MIN_LENGTH = 3;
const MAX_LENGTH = 48;

/** Random names avoid ambiguous characters so they are easy to read aloud. */
const RANDOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Lower-cases a room name and returns it, or null when it is not valid: 3 to
 * 48 characters, lowercase letters and digits, with single hyphens between.
 */
export function normalizeRoom(raw: string): string | null {
  const room = raw.trim().toLowerCase();
  if (room.length < MIN_LENGTH || room.length > MAX_LENGTH) return null;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(room)) return null;
  return room;
}

/** Reads the room name from a URL path such as "/standup". */
export function roomFromPath(pathname: string): string | null {
  const segment = pathname.replace(/^\/+|\/+$/g, '');
  if (segment === '') return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return normalizeRoom(decoded);
}

/** Returns a hard-to-guess name such as "kfj-2hd-9xq". */
export function randomRoomName(random: (length: number) => Uint8Array = cryptoBytes): string {
  const limit = 256 - (256 % RANDOM_ALPHABET.length);
  const chars: string[] = [];
  while (chars.length < 10) {
    for (const byte of random(16)) {
      if (byte < limit && chars.length < 10) {
        chars.push(RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length] as string);
      }
    }
  }
  const joined = chars.join('');
  return `${joined.slice(0, 3)}-${joined.slice(3, 7)}-${joined.slice(7)}`;
}

/** Returns the address people open to join a room. */
export function roomUrl(room: string): string {
  return `${window.location.origin}/${room}`;
}

function cryptoBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
