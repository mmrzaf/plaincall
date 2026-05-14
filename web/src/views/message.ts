import { h } from '../dom';

export interface MessageOptions {
  title: string;
  message: string;
  /** A main button, shown before the link home. */
  action?: { label: string; onClick: () => void };
  /** Show a link back to the start page. */
  home?: boolean;
}

/** Fills the page with a short message, used for endings and unsupported browsers. */
export function showMessage(root: HTMLElement, options: MessageOptions): void {
  root.replaceChildren(
    h(
      'main',
      { class: 'center' },
      h(
        'section',
        { class: 'card message', role: 'alert' },
        h('h1', null, options.title),
        h('p', { class: 'muted' }, options.message),
        h(
          'div',
          { class: 'message-actions' },
          options.action ? h('button', { class: 'btn primary', type: 'button', onclick: options.action.onClick }, options.action.label) : null,
          options.home ? h('a', { class: 'btn', href: '/' }, 'Back to start') : null,
        ),
      ),
    ),
  );
}
