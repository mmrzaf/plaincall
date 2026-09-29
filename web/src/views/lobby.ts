import { LocalAudioTrack, LocalTrack, LocalVideoTrack, createAudioAnalyser } from 'livekit-client';
import { ApiError, join, type JoinGrant } from '../api';
import {
  deviceErrorMessage,
  fillDeviceSelect,
  listDevices,
  openCamera,
  openMicrophone,
  supportsAudioOutputSelection,
} from '../devices';
import { field, h, setText } from '../dom';
import { icon, setIcon } from '../icons';
import { QUALITIES, isQuality, type Quality } from '../quality';
import { storage, type DeviceChoices } from '../storage';
import type { CallInit } from './call';

/** How often a waiting guest asks again whether a host has arrived. */
const WAIT_POLL_MS = 4000;

/**
 * Shows the screen where people pick a name and check their devices before
 * joining. When they join, `onJoined` receives everything the call needs,
 * including the microphone and camera already open for the preview.
 */
export function showLobby(root: HTMLElement, room: string, onJoined: (init: CallInit) => void): void {
  const preferences = storage.getPreferences();
  const choices: DeviceChoices = storage.getDevices();
  let micOn = preferences.micOn;
  let cameraOn = preferences.cameraOn;
  let savedKey = storage.getKey();

  let audio: LocalAudioTrack | undefined;
  let video: LocalVideoTrack | undefined;
  let stopMeter: () => void = () => {};
  let attemptId = 0; // changes whenever a join attempt is started or cancelled
  let waitTimer: number | undefined;

  // ---- Elements -----------------------------------------------------------

  const previewVideo = h('video', { autoplay: true, playsInline: true, muted: true });
  const previewOff = h('div', { class: 'preview-off' });
  const meterBar = h('span');
  const micButton = h('button', { class: 'round', type: 'button' });
  const cameraButton = h('button', { class: 'round', type: 'button' });
  const preview = h(
    'div',
    { class: 'preview' },
    previewVideo,
    previewOff,
    h('div', { class: 'preview-controls' }, micButton, cameraButton),
    h('div', { class: 'meter', 'aria-hidden': 'true' }, meterBar),
  );

  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    maxLength: 40,
    autocomplete: 'name',
    spellcheck: false,
    placeholder: 'Your name',
    value: storage.getName(),
  });
  const keyInput = h('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    spellcheck: false,
    placeholder: 'Host key',
  });
  const keyArea = h('div', { class: 'key-area' });

  // Hosts choose how a new room handles video. An existing room keeps its own.
  const qualitySelect = h(
    'select',
    { class: 'input', 'aria-label': 'Room style' },
    ...QUALITIES.map((q) => h('option', { value: q.id }, `${q.label} · ${q.hint}`)),
  );
  qualitySelect.value = storage.getQuality();
  const qualityRow = h(
    'div',
    { class: 'quality-row' },
    field('Room style', qualitySelect),
    h('p', { class: 'muted small' }, 'Used only when you start the room. A room already running keeps its own style.'),
  );

  const micSelect = h('select', { class: 'input', 'aria-label': 'Microphone' });
  const cameraSelect = h('select', { class: 'input', 'aria-label': 'Camera' });
  const speakerSelect = h('select', { class: 'input', 'aria-label': 'Speaker' });
  const speakerRow = supportsAudioOutputSelection() ? field('Speaker', speakerSelect) : null;

  const notice = h('p', { class: 'notice', role: 'status', 'aria-live': 'polite' });
  const joinButton = h('button', { class: 'btn primary wide', type: 'submit' }, 'Join call');
  const waiting = h('div', { class: 'waiting', hidden: true });

  const form = h(
    'form',
    { class: 'card form', novalidate: true },
    h('h1', null, 'Join ', h('span', { class: 'room-name' }, room)),
    field('Your name', nameInput),
    keyArea,
    h('div', { class: 'devices' }, field('Microphone', micSelect), field('Camera', cameraSelect), speakerRow),
    notice,
    joinButton,
    waiting,
  );

  root.replaceChildren(
    h(
      'main',
      { class: 'lobby' },
      h('header', { class: 'topbar' }, h('a', { class: 'brand', href: '/' }, 'PlainCall')),
      h('div', { class: 'lobby-body' }, preview, form),
    ),
  );

  // ---- Preview ------------------------------------------------------------

  const currentDevice = (track?: LocalTrack): string | undefined => track?.mediaStreamTrack.getSettings().deviceId;

  function say(message: string, kind: 'info' | 'error' = 'info'): void {
    setText(notice, message);
    notice.className = `notice ${kind}`;
  }

  function renderPreview(): void {
    previewVideo.classList.toggle('mirror', preferences.mirror);
    previewVideo.hidden = !video;
    previewOff.hidden = Boolean(video);
    setText(previewOff, cameraOn ? 'Camera unavailable' : 'Camera is off');

    setIcon(micButton, micOn && audio ? 'mic' : 'micOff');
    micButton.classList.toggle('off', !micOn || !audio);
    micButton.setAttribute('aria-label', micOn ? 'Mute microphone' : 'Unmute microphone');
    setIcon(cameraButton, cameraOn && video ? 'video' : 'videoOff');
    cameraButton.classList.toggle('off', !cameraOn || !video);
    cameraButton.setAttribute('aria-label', cameraOn ? 'Turn camera off' : 'Turn camera on');
  }

  function remember(): void {
    storage.setPreferences({ ...storage.getPreferences(), micOn, cameraOn });
  }

  async function refreshDevices(): Promise<void> {
    const [mics, cameras, speakers] = await Promise.all([
      listDevices('audioinput'),
      listDevices('videoinput'),
      listDevices('audiooutput'),
    ]);
    fillDeviceSelect(micSelect, mics, 'Microphone', currentDevice(audio) ?? choices.audioinput);
    fillDeviceSelect(cameraSelect, cameras, 'Camera', currentDevice(video) ?? choices.videoinput);
    fillDeviceSelect(speakerSelect, speakers, 'Speaker', choices.audiooutput);
  }

  function watchLevel(track: LocalAudioTrack): void {
    stopMeter();
    const analyser = createAudioAnalyser(track);
    let running = true;
    const tick = (): void => {
      if (!running) return;
      meterBar.style.width = `${Math.min(100, Math.round(analyser.calculateVolume() * 160))}%`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    stopMeter = () => {
      running = false;
      meterBar.style.width = '0%';
      void analyser.cleanup();
      stopMeter = () => {};
    };
  }

  async function startMicrophone(): Promise<void> {
    stopMicrophone();
    try {
      audio = await openMicrophone(choices.audioinput);
      if (!micOn) await audio.mute();
      watchLevel(audio);
    } catch (error) {
      say(deviceErrorMessage(error, 'microphone'), 'error');
    }
    renderPreview();
  }

  function stopMicrophone(): void {
    stopMeter();
    audio?.stop();
    audio = undefined;
  }

  async function startCamera(): Promise<void> {
    stopCamera();
    try {
      video = await openCamera(choices.videoinput);
      video.attach(previewVideo);
    } catch (error) {
      say(deviceErrorMessage(error, 'camera'), 'error');
    }
    renderPreview();
  }

  function stopCamera(): void {
    video?.detach(previewVideo);
    video?.stop();
    video = undefined;
  }

  const onDeviceChange = (): void => void refreshDevices();
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);

  micButton.addEventListener('click', async () => {
    micOn = !micOn;
    if (audio) {
      await (micOn ? audio.unmute() : audio.mute());
    } else if (micOn) {
      await startMicrophone();
    }
    remember();
    renderPreview();
  });

  cameraButton.addEventListener('click', async () => {
    cameraOn = !cameraOn;
    if (cameraOn) await startCamera();
    else stopCamera();
    remember();
    renderPreview();
    void refreshDevices();
  });

  micSelect.addEventListener('change', async () => {
    choices.audioinput = micSelect.value;
    storage.setDevices(choices);
    await startMicrophone();
  });
  cameraSelect.addEventListener('change', async () => {
    choices.videoinput = cameraSelect.value;
    storage.setDevices(choices);
    if (cameraOn) await startCamera();
  });
  speakerSelect.addEventListener('change', () => {
    choices.audiooutput = speakerSelect.value;
    storage.setDevices(choices);
  });

  // ---- Host key -----------------------------------------------------------

  function renderKeyArea(open = false): void {
    if (savedKey) {
      keyArea.replaceChildren(
        h(
          'div',
          { class: 'key-saved' },
          icon('crown', 16),
          h('span', null, 'You will join as a host.'),
          h(
            'button',
            {
              class: 'link',
              type: 'button',
              onclick: () => {
                storage.clearKey();
                savedKey = '';
                renderKeyArea();
              },
            },
            'Forget key',
          ),
        ),
        qualityRow,
      );
      return;
    }
    const details = h(
      'details',
      { class: 'key-details', open },
      h('summary', null, 'I have a host key'),
      keyInput,
      qualityRow,
    );
    keyArea.replaceChildren(details);
  }

  // ---- Joining ------------------------------------------------------------

  function setBusy(busy: boolean): void {
    joinButton.disabled = busy;
    nameInput.disabled = busy;
    keyInput.disabled = busy;
    setText(joinButton, busy ? 'Joining…' : 'Join call');
  }

  function showWaiting(): void {
    joinButton.hidden = true;
    waiting.hidden = false;
    waiting.replaceChildren(
      h('div', { class: 'waiting-text' }, icon('loader', 18), h('span', null, 'Waiting for the host to arrive…')),
      h('p', { class: 'muted' }, 'You will join automatically as soon as a host is in the call.'),
      h('button', { class: 'btn wide', type: 'button', onclick: cancelWaiting }, 'Cancel'),
    );
  }

  function cancelWaiting(): void {
    attemptId++;
    window.clearTimeout(waitTimer);
    waiting.hidden = true;
    joinButton.hidden = false;
    setBusy(false);
    say('');
  }

  function selectedQuality(): Quality {
    return isQuality(qualitySelect.value) ? qualitySelect.value : QUALITIES[0]!.id;
  }

  async function attempt(id: number, name: string, key: string): Promise<void> {
    let grant: JoinGrant;
    try {
      grant = await join(room, name, key || undefined, selectedQuality());
    } catch (error) {
      if (id !== attemptId) return;
      if (error instanceof ApiError && error.code === 'waiting_for_host') {
        showWaiting();
        waitTimer = window.setTimeout(() => void attempt(id, name, key), WAIT_POLL_MS);
        return;
      }
      waiting.hidden = true;
      joinButton.hidden = false;
      setBusy(false);
      if (error instanceof ApiError && error.code === 'invalid_key') {
        storage.clearKey();
        savedKey = '';
        renderKeyArea(true);
        say(key === keyInput.value.trim() ? error.message : 'Your saved host key is no longer valid.', 'error');
      } else {
        say(error instanceof Error ? error.message : 'Could not join the call.', 'error');
      }
      return;
    }
    if (id !== attemptId) return;

    if (key) {
      storage.setKey(key);
      storage.setQuality(selectedQuality());
    }
    stopWatching();
    onJoined({ room, name, grant, key: grant.role === 'member' ? key : '', audio, video, choices, cameraOn, micOn });
  }

  /** Stops watching for changes, but leaves the tracks open for the call. */
  function stopWatching(): void {
    stopMeter();
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = nameInput.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      say('Enter your name to join.', 'error');
      nameInput.focus();
      return;
    }
    say('');
    storage.setName(name);
    setBusy(true);
    attemptId++;
    void attempt(attemptId, name, savedKey || keyInput.value.trim());
  });

  // ---- Start --------------------------------------------------------------

  renderKeyArea();
  renderPreview();
  void (async () => {
    await Promise.all([startMicrophone(), cameraOn ? startCamera() : undefined]);
    await refreshDevices();
    if (!nameInput.value) nameInput.focus();
  })();
}
