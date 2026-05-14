// Small helpers for building DOM without a framework.

export type Child = Node | string | null | undefined | false;

type Props = Record<string, unknown>;

/**
 * Creates an element. Props starting with "on" add event listeners, "class"
 * sets the class name, properties that exist on the element are assigned, and
 * everything else becomes an attribute. `null`, `undefined` and `false` props
 * and children are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    } else if (name === 'class') {
      element.className = String(value);
    } else if (name in element && !name.includes('-')) {
      (element as unknown as Props)[name] = value;
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  append(element, children);
  return element;
}

/** Appends children, turning strings into text nodes. */
export function append(parent: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** A form control with a label above it. */
export function field(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
}

/** Finds an element that must exist. */
export function must<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** Text shown inside an element, kept in sync only when it changes. */
export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/**
 * Asks the person to confirm an action in a modal dialog. Resolves true only
 * when they choose the confirm button.
 */
export function confirmDialog(options: { title: string; message: string; confirmLabel: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' });
    const finish = (result: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    const cancel = h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Cancel');
    const confirm = h('button', { class: 'btn danger', type: 'button', onclick: () => finish(true) }, options.confirmLabel);
    append(dialog, [
      h('h2', { id: 'dialog-title' }, options.title),
      h('p', null, options.message),
      h('div', { class: 'dialog-actions' }, cancel, confirm),
    ]);
    // Escape closes a modal dialog natively; treat that as declining.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
