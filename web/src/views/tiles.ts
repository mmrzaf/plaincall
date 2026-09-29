import { Participant, Room, Track } from 'livekit-client';
import { h, setText } from '../dom';
import { icon } from '../icons';
import { computeGrid } from '../layout';

const GAP = 10;

interface Tile {
  /** Who the tile shows. */
  identity: string;
  el: HTMLElement;
  /** Pins or unpins the person. Only camera tiles have one. */
  pin?: HTMLButtonElement;
  media: HTMLElement;
  video: HTMLVideoElement;
  avatar: HTMLElement;
  label: HTMLElement;
  badges: HTMLElement;
  track?: Track;
}

export interface StageState {
  /** Mirror the local camera, like a mirror would. */
  mirrorSelf: boolean;
  /** The person shown large by this viewer, if any. */
  pinned?: string;
}

/**
 * The area that shows everyone in the call: screen shares in a large stage and
 * one tile per participant.
 */
export class Stage {
  readonly el: HTMLElement;
  private readonly grid = h('section', { class: 'grid', 'aria-label': 'Participants' });
  private readonly screens = h('section', { class: 'screens', 'aria-label': 'Shared screens' });
  private readonly tiles = new Map<string, Tile>();
  private readonly shares = new Map<string, Tile>();
  private readonly pinnedTiles = new Map<string, Tile>();
  private readonly observer: ResizeObserver;
  private tileCount = 1;

  constructor(private readonly onPin: (identity: string) => void = () => {}) {
    this.el = h('main', { class: 'stage' }, this.screens, this.grid);
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.grid);
  }

  destroy(): void {
    this.observer.disconnect();
  }

  update(room: Room, state: StageState): void {
    const participants: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];

    // One tile per participant, showing their camera or an avatar.
    const cameraTiles = this.reconcile(this.tiles, participants, (p) => p.identity, (id) => createTile(id, 'participant-tile', this.onPin));
    participants.forEach((participant, index) => {
      const tile = cameraTiles[index] as Tile;
      const local = participant === room.localParticipant;
      this.updateCamera(tile, participant, local, local && state.mirrorSelf);
      const pinned = participant.identity === state.pinned;
      tile.el.classList.toggle('pinned', pinned);
      if (tile.pin) {
        tile.pin.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${displayName(participant)}`);
        tile.pin.setAttribute('aria-pressed', String(pinned));
        tile.pin.replaceChildren(icon(pinned ? 'pinOff' : 'pin', 16));
      }
    });
    placeInOrder(this.grid, cameraTiles.map((tile) => tile.el));

    // Large tiles: one for a pinned person, and one per screen share.
    const featured = participants.filter((p) => p.identity === state.pinned);
    const pinnedTiles = this.reconcile(this.pinnedTiles, featured, (p) => p.identity, (id) => createTile(id, 'screen-tile pinned-tile', this.onPin, true));
    featured.forEach((participant, index) => {
      const tile = pinnedTiles[index] as Tile;
      const local = participant === room.localParticipant;
      this.updateCamera(tile, participant, local, local && state.mirrorSelf);
      tile.pin?.setAttribute('aria-label', `Unpin ${displayName(participant)}`);
    });

    const sharing = participants.filter((p) => screenTrack(p) !== undefined);
    const shareTiles = this.reconcile(this.shares, sharing, (p) => p.identity, (id) => createTile(id, 'screen-tile'));
    sharing.forEach((participant, index) => {
      const tile = shareTiles[index] as Tile;
      const local = participant === room.localParticipant;
      setVideo(tile, screenTrack(participant));
      setText(tile.label, local ? 'Your screen' : `${displayName(participant)}’s screen`);
    });
    const large = [...pinnedTiles, ...shareTiles];
    placeInOrder(this.screens, large.map((tile) => tile.el));

    this.el.classList.toggle('sharing', large.length > 0);
    this.screens.dataset['count'] = String(large.length);
    this.tileCount = participants.length;
    this.fit();
  }

  /** Sizes camera tiles to make the best use of the space when nothing is shared. */
  private fit(): void {
    const width = this.grid.clientWidth;
    const height = this.grid.clientHeight;
    if (width === 0 || height === 0) return;
    const aspect = width >= height ? 16 / 9 : 3 / 4;
    const layout = computeGrid(this.tileCount, width, height, GAP, aspect);
    this.grid.style.setProperty('--tile-w', `${layout.tileWidth}px`);
    this.grid.style.setProperty('--tile-h', `${layout.tileHeight}px`);
  }

  private updateCamera(tile: Tile, participant: Participant, local: boolean, mirror: boolean): void {
    const publication = participant.getTrackPublication(Track.Source.Camera);
    setVideo(tile, publication && !publication.isMuted ? publication.track : undefined);
    tile.video.classList.toggle('mirror', mirror);

    const name = displayName(participant);
    setText(tile.label, local ? `${name} (you)` : name);
    setText(tile.avatar, initials(name));
    tile.el.classList.toggle('speaking', participant.isSpeaking);

    const quality = participant.connectionQuality;
    tile.badges.replaceChildren(
      ...[
        participant.attributes['role'] === 'member' ? badge('crown', 'Host') : null,
        participant.isMicrophoneEnabled ? null : badge('micOff', 'Muted'),
        quality === 'poor' || quality === 'lost' ? badge('signalLow', 'Poor connection', 'warn') : null,
      ].filter((node): node is HTMLElement => node !== null),
    );
  }

  /** Keeps `tiles` in step with `items`, creating and removing tiles as needed. */
  private reconcile<T>(tiles: Map<string, Tile>, items: T[], key: (item: T) => string, create: (id: string) => Tile): Tile[] {
    const wanted = new Set(items.map(key));
    for (const [id, tile] of tiles) {
      if (wanted.has(id)) continue;
      setVideo(tile, undefined);
      tile.el.remove();
      tiles.delete(id);
    }
    return items.map((item) => {
      const id = key(item);
      let tile = tiles.get(id);
      if (!tile) {
        tile = create(id);
        tiles.set(id, tile);
      }
      return tile;
    });
  }
}

function createTile(identity: string, className: string, onPin?: (identity: string) => void, pinned = false): Tile {
  const video = h('video', { autoplay: true, playsInline: true, muted: true });
  const avatar = h('div', { class: 'avatar', 'aria-hidden': 'true' });
  const pin = onPin
    ? h(
        'button',
        { class: 'tile-pin', type: 'button', onclick: () => onPin(identity) },
        icon(pinned ? 'pinOff' : 'pin', 16),
      )
    : undefined;
  const media = h('div', { class: 'tile-media' }, video, avatar, pin);
  const label = h('span', { class: 'tile-name' });
  const badges = h('span', { class: 'tile-badges' });
  const el = h('article', { class: className }, media, h('div', { class: 'tile-bar' }, label, badges));
  return { identity, el, media, video, avatar, label, badges, pin };
}

/** Points a tile's video at `track`, releasing the previous one. */
function setVideo(tile: Tile, track: Track | undefined): void {
  if (tile.track !== track) {
    tile.track?.detach(tile.video);
    tile.track = track;
    track?.attach(tile.video);
  }
  tile.media.classList.toggle('has-video', track !== undefined);
}

function screenTrack(participant: Participant): Track | undefined {
  const publication = participant.getTrackPublication(Track.Source.ScreenShare);
  return publication && !publication.isMuted ? publication.track : undefined;
}

function badge(name: 'crown' | 'micOff' | 'signalLow', title: string, kind = ''): HTMLElement {
  return h('span', { class: `badge ${kind}`.trim(), title }, icon(name, 14));
}

export function displayName(participant: Participant): string {
  return participant.name || 'Guest';
}

export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** Puts `elements` in `parent` in the given order, moving only what has to move. */
function placeInOrder(parent: HTMLElement, elements: HTMLElement[]): void {
  elements.forEach((element, index) => {
    const current = parent.children[index];
    if (current !== element) parent.insertBefore(element, current ?? null);
  });
}
