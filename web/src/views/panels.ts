import { Participant, Room } from 'livekit-client';
import { append, field, h } from '../dom';
import { icon } from '../icons';
import { displayName, initials } from './tiles';
import { deviceOptionsFor, type DeviceSelectors } from './devicePicker';
import { supportsAudioOutputSelection } from '../devices';

/** A side panel with a title and a close button. */
export class Panel {
  readonly el: HTMLElement;
  readonly body = h('div', { class: 'panel-body' });

  constructor(title: string, onClose: () => void) {
    this.el = h(
      'aside',
      { class: 'panel', hidden: true, 'aria-label': title },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', null, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Close ${title.toLowerCase()}`, onclick: onClose }, icon('x')),
      ),
      this.body,
    );
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  set open(value: boolean) {
    this.el.hidden = !value;
  }
}

export interface PeopleActions {
  remove(participant: Participant): void;
  toggleLock(): void;
  end(): void;
}

/** Lists everyone in the call. Members also get moderation controls. */
export class PeoplePanel {
  readonly panel: Panel;
  private readonly list = h('ul', { class: 'people' });
  private readonly lockButton = h('button', { class: 'btn wide', type: 'button' });
  private readonly endButton = h('button', { class: 'btn danger wide', type: 'button' }, 'End call for everyone');

  constructor(
    private readonly isMember: boolean,
    private readonly actions: PeopleActions,
    onClose: () => void,
  ) {
    this.panel = new Panel('People', onClose);
    this.panel.body.append(this.list);
    if (isMember) {
      this.lockButton.addEventListener('click', () => actions.toggleLock());
      this.endButton.addEventListener('click', () => actions.end());
      this.panel.body.append(
        h(
          'div',
          { class: 'panel-actions' },
          this.lockButton,
          h('p', { class: 'muted small' }, 'A locked room lets no new guests in. Hosts can always join.'),
          this.endButton,
        ),
      );
    }
  }

  update(room: Room, locked: boolean, busy: boolean): void {
    if (this.isMember) {
      this.lockButton.replaceChildren(icon(locked ? 'lockOpen' : 'lock', 18), locked ? 'Unlock room' : 'Lock room');
      this.lockButton.disabled = busy;
      this.endButton.disabled = busy;
    }
    if (!this.panel.open) return;

    const participants = [room.localParticipant, ...room.remoteParticipants.values()];
    this.list.replaceChildren(
      ...participants.map((participant) => {
        const local = participant === room.localParticipant;
        const name = displayName(participant);
        const host = participant.attributes['role'] === 'member';
        return h(
          'li',
          { class: 'person' },
          h('span', { class: 'avatar small', 'aria-hidden': 'true' }, initials(name)),
          h(
            'span',
            { class: 'person-name' },
            local ? `${name} (you)` : name,
            host ? h('span', { class: 'chip' }, 'Host') : null,
          ),
          participant.isMicrophoneEnabled ? null : h('span', { class: 'muted-mic', title: 'Muted' }, icon('micOff', 16)),
          this.isMember && !local
            ? h(
                'button',
                {
                  class: 'icon-btn danger',
                  type: 'button',
                  'aria-label': `Remove ${name}`,
                  title: 'Remove from call',
                  disabled: busy,
                  onclick: () => this.actions.remove(participant),
                },
                icon('userX', 18),
              )
            : null,
        );
      }),
    );
  }
}

export interface SettingsActions {
  device(kind: 'audioinput' | 'audiooutput' | 'videoinput', deviceId: string): void;
  mirror(on: boolean): void;
  audioOnly(on: boolean): void;
}

/** Device pickers and the few call-wide preferences. */
export class SettingsPanel {
  readonly panel: Panel;
  private readonly selectors: DeviceSelectors;
  private readonly mirror = h('input', { type: 'checkbox' });
  private readonly audioOnly = h('input', { type: 'checkbox' });

  constructor(actions: SettingsActions, mirror: boolean, onClose: () => void) {
    this.panel = new Panel('Settings', onClose);
    this.selectors = {
      audioinput: h('select', { class: 'input', 'aria-label': 'Microphone' }),
      audiooutput: h('select', { class: 'input', 'aria-label': 'Speaker' }),
      videoinput: h('select', { class: 'input', 'aria-label': 'Camera' }),
    };
    for (const kind of ['audioinput', 'audiooutput', 'videoinput'] as const) {
      this.selectors[kind].addEventListener('change', () => actions.device(kind, this.selectors[kind].value));
    }
    this.mirror.checked = mirror;
    this.mirror.addEventListener('change', () => actions.mirror(this.mirror.checked));
    this.audioOnly.addEventListener('change', () => actions.audioOnly(this.audioOnly.checked));

    append(this.panel.body, [
      field('Microphone', this.selectors.audioinput),
      supportsAudioOutputSelection() ? field('Speaker', this.selectors.audiooutput) : null,
      field('Camera', this.selectors.videoinput),
      check(this.mirror, 'Mirror my camera', 'Only changes how you see yourself.'),
      check(this.audioOnly, 'Audio only', 'Turns off your camera and stops receiving video, to save data.'),
    ]);
  }

  setAudioOnly(on: boolean): void {
    this.audioOnly.checked = on;
  }

  async refresh(room: Room): Promise<void> {
    await deviceOptionsFor(this.selectors, (kind) => room.getActiveDevice(kind));
  }
}

function check(input: HTMLInputElement, label: string, hint: string): HTMLElement {
  const text = h('span', null, h('span', { class: 'check-label' }, label), h('span', { class: 'muted small block' }, hint));
  return h('label', { class: 'check' }, input, text);
}

