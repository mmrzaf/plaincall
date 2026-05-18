import { h, setText } from '../dom';
import { icon } from '../icons';
import { normalizeRoom, randomRoomName } from '../rooms';

/** The start page: pick a room name, or make a random one. */
export function showLanding(root: HTMLElement, error?: string): void {
  const input = h('input', {
    class: 'input',
    type: 'text',
    maxLength: 48,
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: false,
    placeholder: 'Room name, like standup',
    'aria-label': 'Room name',
  });
  const status = h('p', { class: 'notice error', role: 'status', 'aria-live': 'polite' }, error ?? '');

  const form = h(
    'form',
    { class: 'landing-form', novalidate: true },
    input,
    h('button', { class: 'btn primary', type: 'submit' }, 'Join', icon('arrowRight', 18)),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const room = normalizeRoom(input.value);
    if (!room) {
      setText(status, 'Use 3 to 48 letters, digits and hyphens, for example team-standup.');
      input.focus();
      return;
    }
    window.location.assign(`/${room}`);
  });

  const random = h(
    'button',
    { class: 'btn', type: 'button', onclick: () => window.location.assign(`/${randomRoomName()}`) },
    icon('shuffle', 18),
    'Start a private room',
  );

  root.replaceChildren(
    h(
      'main',
      { class: 'center' },
      h(
        'section',
        { class: 'card landing' },
        h('div', { class: 'logo', 'aria-hidden': 'true' }, icon('video', 26)),
        h('h1', null, 'PlainCall'),
        h('p', { class: 'muted' }, 'Simple video calls. Pick a room name and share the link.'),
        form,
        status,
        h('div', { class: 'or' }, h('span', null, 'or')),
        random,
      ),
    ),
  );
  input.focus();
}
