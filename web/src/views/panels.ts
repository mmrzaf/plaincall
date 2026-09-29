import { Participant, Room } from 'livekit-client';
import { append, field, h } from '../dom';
import { icon } from '../icons';
import { MAX_CHAT_LENGTH, MAX_KEPT, type ChatMessage } from '../chat';
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
  mute(participant: Participant): void;
  muteGuests(): void;
  toggleLock(): void;
  end(): void;
}

/** Lists everyone in the call. Members also get moderation controls. */
export class PeoplePanel {
  readonly panel: Panel;
  private readonly list = h('ul', { class: 'people' });
  private readonly muteAllButton = h('button', { class: 'btn wide', type: 'button' }, icon('micOff', 18), 'Mute all guests');
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
      this.muteAllButton.addEventListener('click', () => actions.muteGuests());
      this.lockButton.addEventListener('click', () => actions.toggleLock());
      this.endButton.addEventListener('click', () => actions.end());
      this.panel.body.append(
        h(
          'div',
          { class: 'panel-actions' },
          this.muteAllButton,
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
      this.muteAllButton.disabled = busy;
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
          this.isMember && !local && participant.isMicrophoneEnabled
            ? h(
                'button',
                {
                  class: 'icon-btn',
                  type: 'button',
                  'aria-label': `Mute ${name}`,
                  title: 'Mute microphone',
                  disabled: busy,
                  onclick: () => this.actions.mute(participant),
                },
                icon('micOff', 18),
              )
            : null,
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
      field('Camera', this.selectors.videoinput),
      supportsAudioOutputSelection() ? field('Speaker', this.selectors.audiooutput) : null,
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


/** The room's chat. Messages last only as long as the call. */
export class ChatPanel {
  readonly panel: Panel;
  private readonly list = h('ul', { class: 'chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' });
  private readonly empty = h('p', { class: 'muted small chat-empty' }, 'No messages yet. Messages are visible only while you are in the call.');
  private readonly input = h('textarea', {
    class: 'input chat-input',
    rows: 2,
    maxLength: MAX_CHAT_LENGTH,
    placeholder: 'Message everyone',
    'aria-label': 'Message',
  });
  private lastFrom = '';

  constructor(
    private readonly send: (text: string) => Promise<boolean>,
    onClose: () => void,
  ) {
    this.panel = new Panel('Chat', onClose);
    const form = h(
      'form',
      { class: 'chat-form' },
      this.input,
      h('button', { class: 'btn primary', type: 'submit' }, 'Send'),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    // Enter sends, Shift+Enter starts a new line.
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.panel.body.classList.add('chat');
    this.panel.body.append(h('div', { class: 'chat-scroll' }, this.empty, this.list), form);
  }

  focus(): void {
    this.input.focus();
    this.scroll(true);
  }

  add(message: ChatMessage): void {
    const scroller = this.list.parentElement;
    const nearEnd = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    this.empty.hidden = true;

    const sameSender = this.lastFrom === message.from;
    this.lastFrom = message.from;
    const time = message.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.list.append(
      h(
        'li',
        { class: `chat-message${message.mine ? ' mine' : ''}${sameSender ? ' follow' : ''}` },
        sameSender ? null : h('div', { class: 'chat-meta' }, h('span', { class: 'chat-name' }, message.mine ? 'You' : message.name), h('time', null, time)),
        h('p', { class: 'chat-text' }, message.text),
      ),
    );
    while (this.list.children.length > MAX_KEPT) this.list.firstElementChild?.remove();
    if (nearEnd || message.mine) this.scroll(false);
  }

  private async submit(): Promise<void> {
    const text = this.input.value;
    if (text.trim() === '') return;
    if (await this.send(text)) this.input.value = '';
    this.input.focus();
  }

  private scroll(force: boolean): void {
    const scroller = this.list.parentElement;
    if (scroller && (force || this.panel.open)) scroller.scrollTop = scroller.scrollHeight;
  }
}
