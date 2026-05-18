import './styles.css';
import { roomFromPath } from './rooms';
import { showLanding } from './views/landing';
import { showMessage } from './views/message';

const root = document.getElementById('app');
if (!root) throw new Error('The page has no #app element.');
const app: HTMLElement = root;

async function start(): Promise<void> {
  const path = window.location.pathname;
  const room = roomFromPath(path);

  if (path.replace(/\/+$/, '') === '') {
    showLanding(app);
    return;
  }
  if (!room) {
    window.history.replaceState(null, '', '/');
    showLanding(app, 'That is not a valid room name. Use 3 to 48 letters, digits and hyphens.');
    return;
  }

  // The calling code is large, so it loads only for pages that need it.
  const [{ isBrowserSupported }, { showLobby }, { startCall }] = await Promise.all([
    import('livekit-client'),
    import('./views/lobby'),
    import('./views/call'),
  ]);

  if (!window.isSecureContext || !navigator.mediaDevices || !isBrowserSupported()) {
    showMessage(app, {
      title: 'This browser cannot join calls',
      message: window.isSecureContext
        ? 'Use a current version of Chrome, Edge, Firefox or Safari.'
        : 'Calls need a secure connection. Open this page over https://.',
      home: true,
    });
    return;
  }

  // Use the canonical spelling of the room in the address bar.
  if (path !== `/${room}`) window.history.replaceState(null, '', `/${room}`);
  document.title = `${room} · PlainCall`;
  showLobby(app, room, (init) => void startCall(app, init));
}

void start();
