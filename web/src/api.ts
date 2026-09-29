import { DEFAULT_QUALITY, isQuality, type Quality } from './quality';

export type Role = 'member' | 'guest';

export interface JoinGrant {
  /** WebSocket address of the media server. */
  url: string;
  token: string;
  role: Role;
  /** The room's preset, which every browser applies to its video. */
  quality: Quality;
}

/** An error reported by the server, or a failure to reach it. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, body: unknown, key?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Authorization'] = `Bearer ${key}`;

  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 'Could not reach the server. Check your connection.', 0);
  }

  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = (payload ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      failure.code ?? 'error',
      failure.message ?? `The server returned an error (${response.status}).`,
      response.status,
    );
  }
  return payload as T;
}

/**
 * Asks to join a room. Include `key` to join as a member. A member starting a
 * new room chooses its preset with `quality`. An existing room keeps its own.
 */
export async function join(room: string, name: string, key?: string, quality?: Quality): Promise<JoinGrant> {
  const grant = await request<JoinGrant>('/api/join', {
    room,
    name,
    key: key || undefined,
    quality: key ? quality : undefined,
  });
  return { ...grant, quality: isQuality(grant.quality) ? grant.quality : DEFAULT_QUALITY };
}

export function removeParticipant(room: string, identity: string, key: string): Promise<void> {
  return request<void>(`/api/rooms/${encodeURIComponent(room)}/kick`, { identity }, key);
}

export function endRoom(room: string, key: string): Promise<void> {
  return request<void>(`/api/rooms/${encodeURIComponent(room)}/end`, undefined, key);
}

export function setRoomLocked(room: string, locked: boolean, key: string): Promise<void> {
  return request<void>(`/api/rooms/${encodeURIComponent(room)}/lock`, { locked }, key);
}
