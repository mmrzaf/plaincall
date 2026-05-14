import {
  ArrowRight,
  Check,
  Copy,
  Crown,
  LoaderCircle,
  Lock,
  LockOpen,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Settings,
  Shuffle,
  SignalLow,
  UserX,
  Users,
  Video,
  VideoOff,
  X,
  createElement,
  type IconNode,
} from 'lucide';

const ICONS = {
  arrowRight: ArrowRight,
  check: Check,
  copy: Copy,
  crown: Crown,
  loader: LoaderCircle,
  lock: Lock,
  lockOpen: LockOpen,
  mic: Mic,
  micOff: MicOff,
  monitorOff: MonitorOff,
  monitorUp: MonitorUp,
  phoneOff: PhoneOff,
  settings: Settings,
  shuffle: Shuffle,
  signalLow: SignalLow,
  userX: UserX,
  users: Users,
  video: Video,
  videoOff: VideoOff,
  x: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/** Returns a decorative SVG icon. */
export function icon(name: IconName, size = 20): SVGElement {
  const svg = createElement(ICONS[name], { width: size, height: size, 'aria-hidden': 'true', focusable: 'false' });
  svg.classList.add('icon');
  return svg;
}

/** Replaces the contents of an element with an icon. */
export function setIcon(element: Element, name: IconName, size = 20): void {
  element.replaceChildren(icon(name, size));
}
