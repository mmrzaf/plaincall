import {
  ConnectionQuality,
  ConnectionState,
  Participant,
  createLocalAudioTrack,
  createLocalVideoTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client';
import {
  AUDIO_PROFILES,
  MEDIA_PROFILES,
  audioCaptureOptions,
  audioProfile,
  audioProfileTargetLabel,
  audioPublishOptions,
  browserAudioConstraints,
  browserVideoConstraints,
  cameraPublishOptions,
  formatBitrate,
  mediaProfile,
  profileTargetLabel,
  screenCaptureOptions,
  screenPublishOptions,
  videoCaptureOptions,
  type AudioProfile,
  type AudioProfileID,
  type CameraFacing,
  type MediaProfile,
  type MediaProfileID,
  type ScreenProfileID,
} from './mediaProfiles';
import { chooseGridLayout } from './layout';
import './styles.css';

type Devices = { microphones: MediaDeviceInfo[]; cameras: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] };
type JoinResponse = { server_url: string; participant_token: string };
type CreateRoomResponse = { room: string; code?: string; url: string };
type TileEntry = {
  element: HTMLElement;
  media: HTMLElement;
  label: HTMLElement;
  signals: HTMLElement;
  track?: Track;
  video?: HTMLVideoElement;
};
type ScreenTileEntry = {
  element: HTMLElement;
  media: HTMLElement;
  label: HTMLElement;
  track?: Track;
  video?: HTMLVideoElement;
};

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('application root is missing');
const root = appRoot;

// Room invitations live in the URL fragment so they do not reach routine HTTP logs.
// Browsers do not reload the document when only the fragment changes, so reload
// explicitly when creating or manually joining a room from the landing screen.
window.addEventListener('hashchange', () => window.location.reload());

const initialRoomCode = parseRoomCode();
if (initialRoomCode) renderPreJoin(initialRoomCode);
else renderLanding();

function renderLanding(): void {
  root.innerHTML = `
    <main class="shell centered">
      <section class="card hero">
        <p class="eyebrow">PlainCall</p>
        <h1>A room. A code. A call.</h1>
        <p class="muted">Lightweight browser calls for small teams.</p>
        <button id="start-call" class="primary large" type="button">Start a call</button>
        <div class="join-divider"><span>or join with a code</span></div>
        <form id="join-code-form" class="join-code-form">
          <input id="join-code" autocomplete="off" inputmode="text" maxlength="16" placeholder="abc-defg-hjk" aria-label="Room code" />
          <button class="secondary" type="submit">Join</button>
        </form>
        <p id="landing-status" class="status" role="status" aria-live="polite"></p>
      </section>
    </main>`;

  const startButton = required<HTMLButtonElement>('#start-call');
  const form = required<HTMLFormElement>('#join-code-form');
  const codeInput = required<HTMLInputElement>('#join-code');
  const status = required<HTMLParagraphElement>('#landing-status');

  startButton.addEventListener('click', async () => {
    setButtonBusy(startButton, true, 'Creating room…');
    setStatus(status, '');
    try {
      const response = await postJSON<CreateRoomResponse>('/api/rooms', {});
      window.location.assign(response.url);
    } catch (error) {
      setStatus(status, message(error), 'error');
      setButtonBusy(startButton, false, 'Start a call');
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = formatRoomCode(codeInput.value);
    if (!isUsableRoomCode(code)) {
      setStatus(status, 'Enter a room code such as abc-defg-hjk.', 'error');
      codeInput.focus();
      return;
    }
    window.location.assign(inviteURL(code));
  });
}

function renderPreJoin(roomCode: string): void {
  const formattedRoomCode = formatRoomCode(roomCode);
  root.innerHTML = `
    <main class="shell centered">
      <section class="card prejoin">
        <header>
          <a class="brand" href="/">PlainCall</a>
          <h1>Join call</h1>
          <p class="muted">Room <strong class="room-code">${escapeHTML(formattedRoomCode)}</strong>. Check your devices, then join.</p>
        </header>
        <div class="preview-wrap">
          <video id="preview-video" autoplay playsinline muted></video>
          <div id="preview-placeholder" class="preview-placeholder">Camera is off</div>
        </div>
        <label><span>Your name</span><input id="display-name" autocomplete="name" maxlength="48" placeholder="Your name" /></label>
        <div class="device-grid">
          <label><span>Microphone</span><select id="microphone-select"></select></label>
          <label><span>Speaker</span><select id="speaker-select"></select></label>
          <label><span>Camera</span><select id="camera-select"></select></label>
        </div>
        <div class="quality-grid">
          <label><span>Video mode</span><select id="quality-select">${mediaProfileOptions()}</select></label>
          <label><span>Voice mode</span><select id="audio-quality-select">${audioProfileOptions()}</select></label>
        </div>
        <label class="checkbox-label"><input id="mirror-preview" type="checkbox" /><span>Mirror my self-view</span></label>
        <p id="quality-description" class="muted compact-copy"></p>
        <p id="audio-quality-description" class="muted compact-copy"></p>
        <div class="meter" aria-label="Microphone level"><span id="mic-meter"></span></div>
        <div class="button-row wrap">
          <button id="test-devices" class="secondary" type="button">Test devices</button>
          <button id="preview-camera" class="secondary" type="button">Enable camera preview</button>
          <button id="flip-camera" class="secondary" type="button">Flip camera</button>
          <button id="join-call" class="primary" type="button">Join call</button>
        </div>
        <p id="prejoin-status" class="status" role="status" aria-live="polite"></p>
      </section>
    </main>`;

  const nameInput = required<HTMLInputElement>('#display-name');
  const micSelect = required<HTMLSelectElement>('#microphone-select');
  const speakerSelect = required<HTMLSelectElement>('#speaker-select');
  const cameraSelect = required<HTMLSelectElement>('#camera-select');
  const qualitySelect = required<HTMLSelectElement>('#quality-select');
  const audioQualitySelect = required<HTMLSelectElement>('#audio-quality-select');
  const mirrorCheckbox = required<HTMLInputElement>('#mirror-preview');
  const qualityDescription = required<HTMLElement>('#quality-description');
  const audioQualityDescription = required<HTMLElement>('#audio-quality-description');
  const testButton = required<HTMLButtonElement>('#test-devices');
  const cameraPreviewButton = required<HTMLButtonElement>('#preview-camera');
  const flipButton = required<HTMLButtonElement>('#flip-camera');
  const joinButton = required<HTMLButtonElement>('#join-call');
  const status = required<HTMLParagraphElement>('#prejoin-status');
  const previewVideo = required<HTMLVideoElement>('#preview-video');
  const previewPlaceholder = required<HTMLDivElement>('#preview-placeholder');
  const micMeter = required<HTMLSpanElement>('#mic-meter');

  nameInput.value = window.localStorage.getItem('plaincall.displayName') ?? '';
  let activeProfile = mediaProfile(window.localStorage.getItem('plaincall.mediaProfile'));
  let activeAudioProfile = audioProfile(window.localStorage.getItem('plaincall.audioProfile'));
  qualitySelect.value = activeProfile.id;
  audioQualitySelect.value = activeAudioProfile.id;
  let mirrorSelfView = loadBoolean('plaincall.mirrorSelfView', true);
  mirrorCheckbox.checked = mirrorSelfView;
  let cameraFacing: CameraFacing = 'user';
  let previewStream: MediaStream | undefined;
  let meterCleanup: (() => void) | undefined;
  let cameraPreviewEnabled = false;

  const updateProfileUI = (): void => {
    qualityDescription.textContent = `${activeProfile.description}. Target: ${profileTargetLabel(activeProfile)}.`;
    audioQualityDescription.textContent = `${activeAudioProfile.description}. Publish: ${audioProfileTargetLabel(activeAudioProfile)}.`;
    cameraPreviewButton.disabled = activeProfile.audioOnly;
    flipButton.disabled = activeProfile.audioOnly;
    if (activeProfile.audioOnly) cameraPreviewButton.textContent = 'Camera disabled in audio-only mode';
    else cameraPreviewButton.textContent = cameraPreviewEnabled ? 'Disable camera preview' : 'Enable camera preview';
  };

  const syncMirror = (): void => {
    previewVideo.classList.toggle('mirror', mirrorSelfView && cameraFacing === 'user');
  };

  const previewSettingsLabel = (): string => {
    const settings = previewStream?.getVideoTracks()[0]?.getSettings();
    if (!settings?.width || !settings.height) return '';
    const fps = settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : '';
    return `${settings.width}×${settings.height}${fps}`;
  };

  const stopPreview = (): void => {
    meterCleanup?.();
    meterCleanup = undefined;
    previewStream?.getTracks().forEach((track) => track.stop());
    previewStream = undefined;
    previewVideo.srcObject = null;
    micMeter.style.width = '0%';
  };

  const refreshDevices = async (): Promise<void> => {
    const devices = await listDevices();
    updateDeviceSelect(micSelect, devices.microphones, 'Default microphone');
    updateDeviceSelect(speakerSelect, devices.speakers, 'Default speaker');
    updateDeviceSelect(cameraSelect, devices.cameras, 'Default camera');
    speakerSelect.disabled = !supportsOutputSelection();
  };

  const startPreview = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support microphone access.');
    stopPreview();
    const includeCamera = cameraPreviewEnabled && !activeProfile.audioOnly;
    previewStream = await navigator.mediaDevices.getUserMedia({
      audio: browserAudioConstraints(micSelect.value),
      video: includeCamera ? browserVideoConstraints(cameraSelect.value, cameraFacing, activeProfile) : false,
    });
    const audioTrack = previewStream.getAudioTracks()[0];
    if (audioTrack) meterCleanup = startAudioMeter(previewStream, micMeter);
    previewVideo.srcObject = previewStream;
    previewPlaceholder.hidden = includeCamera && previewStream.getVideoTracks().length > 0;
    previewPlaceholder.textContent = includeCamera ? 'Starting camera…' : 'Camera is off';
    syncMirror();
    await refreshDevices();
  };

  updateProfileUI();
  syncMirror();
  refreshDevices().catch(() => undefined);
  navigator.mediaDevices?.addEventListener('devicechange', () => refreshDevices().catch(() => undefined));

  testButton.addEventListener('click', async () => {
    setButtonBusy(testButton, true, 'Testing…');
    setStatus(status, '');
    try { await startPreview(); setStatus(status, 'Microphone ready.', 'success'); }
    catch (error) { setStatus(status, deviceErrorMessage(error), 'error'); }
    finally { setButtonBusy(testButton, false, 'Test devices'); }
  });

  cameraPreviewButton.addEventListener('click', async () => {
    if (activeProfile.audioOnly) return;
    cameraPreviewEnabled = !cameraPreviewEnabled;
    updateProfileUI();
    previewPlaceholder.hidden = false;
    previewPlaceholder.textContent = cameraPreviewEnabled ? 'Starting camera…' : 'Camera is off';
    try {
      await startPreview();
      const actual = previewSettingsLabel();
      setStatus(status, cameraPreviewEnabled ? `Camera preview ready${actual ? `: ${actual}` : ''}.` : 'Camera preview disabled.', 'success');
    } catch (error) {
      cameraPreviewEnabled = false;
      updateProfileUI();
      previewPlaceholder.hidden = false;
      previewPlaceholder.textContent = 'Camera is off';
      setStatus(status, deviceErrorMessage(error), 'error');
    }
  });

  flipButton.addEventListener('click', async () => {
    cameraFacing = cameraFacing === 'user' ? 'environment' : 'user';
    cameraSelect.value = '';
    syncMirror();
    if (!previewStream || !cameraPreviewEnabled) return;
    try { await startPreview(); setStatus(status, `Using ${cameraFacing === 'user' ? 'front' : 'rear'} camera.`, 'success'); }
    catch (error) { setStatus(status, deviceErrorMessage(error), 'error'); }
  });

  mirrorCheckbox.addEventListener('change', () => {
    mirrorSelfView = mirrorCheckbox.checked;
    window.localStorage.setItem('plaincall.mirrorSelfView', String(mirrorSelfView));
    syncMirror();
  });

  qualitySelect.addEventListener('change', async () => {
    activeProfile = mediaProfile(qualitySelect.value);
    window.localStorage.setItem('plaincall.mediaProfile', activeProfile.id);
    if (activeProfile.audioOnly) cameraPreviewEnabled = false;
    updateProfileUI();
    if (previewStream) {
      try {
        await startPreview();
        const actual = previewSettingsLabel();
        setStatus(status, `Applied ${activeProfile.label}${actual ? `: ${actual}` : ''}.`, 'success');
      }
      catch (error) { setStatus(status, deviceErrorMessage(error), 'error'); }
    }
  });

  audioQualitySelect.addEventListener('change', () => {
    activeAudioProfile = audioProfile(audioQualitySelect.value);
    window.localStorage.setItem('plaincall.audioProfile', activeAudioProfile.id);
    updateProfileUI();
    setStatus(status, `Selected ${activeAudioProfile.label}: ${audioProfileTargetLabel(activeAudioProfile)}.`, 'success');
  });

  cameraSelect.addEventListener('change', async () => {
    cameraFacing = inferFacing(cameraSelect);
    syncMirror();
    if (!previewStream || !cameraPreviewEnabled) return;
    try { await startPreview(); }
    catch (error) { setStatus(status, deviceErrorMessage(error), 'error'); }
  });

  joinButton.addEventListener('click', async () => {
    const displayName = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!displayName) { setStatus(status, 'Enter your name before joining.', 'error'); nameInput.focus(); return; }
    window.localStorage.setItem('plaincall.displayName', displayName);
    setButtonBusy(joinButton, true, 'Joining…');
    setStatus(status, 'Connecting…');
    try {
      const credentials = await postJSON<JoinResponse>('/api/token', { room_code: roomCode, participant_name: displayName });
      stopPreview();
      await startCall({
        roomCode, displayName, credentials,
        microphoneID: micSelect.value, speakerID: speakerSelect.value, cameraID: cameraSelect.value,
        startWithCamera: cameraPreviewEnabled && !activeProfile.audioOnly,
        initialProfileID: activeProfile.id, initialAudioProfileID: activeAudioProfile.id, cameraFacing, mirrorSelfView,
      });
    } catch (error) {
      setStatus(status, message(error), 'error');
      setButtonBusy(joinButton, false, 'Join call');
    }
  });
  window.addEventListener('pagehide', stopPreview, { once: true });
}

type StartCallOptions = {
  roomCode: string;
  displayName: string;
  credentials: JoinResponse;
  microphoneID: string;
  speakerID: string;
  cameraID: string;
  startWithCamera: boolean;
  initialProfileID: MediaProfileID;
  initialAudioProfileID: AudioProfileID;
  cameraFacing: CameraFacing;
  mirrorSelfView: boolean;
};

async function startCall(options: StartCallOptions): Promise<void> {
  root.innerHTML = `
    <main class="call-shell">
      <header class="call-header">
        <div><a class="brand" href="/">PlainCall</a><span id="call-state" class="pill">Connecting…</span></div>
        <div class="header-actions"><span class="room-code">${escapeHTML(formatRoomCode(options.roomCode))}</span><button id="copy-link" class="secondary compact" type="button">Copy invite</button></div>
      </header>
      <section id="call-content" class="call-content">
        <section id="screen-stage" class="screen-stage" hidden><div id="stage-heading" class="stage-heading">Screen share</div><div id="screen-media" class="screen-media"></div></section>
        <section id="participant-grid" class="participant-grid" aria-label="Participants"></section>
      </section>
      <section id="audio-container" hidden></section>
      <footer class="control-bar">
        <button id="toggle-mic" class="control" type="button">Mute</button>
        <button id="toggle-camera" class="control" type="button">Camera on</button>
        <button id="toggle-audio-only" class="control" type="button">Audio only</button>
        <button id="toggle-share" class="control optional-control" type="button">Share screen</button>
        <button id="toggle-settings" class="control" type="button">More</button>
        <button id="resume-audio" class="control warn" type="button" hidden>Resume audio</button>
        <button id="leave-call" class="control danger" type="button">Leave</button>
      </footer>
      <aside id="settings-panel" class="devices-panel" hidden>
        <div class="panel-heading"><h2>Call settings</h2><button id="close-settings" class="secondary compact" type="button">Close</button></div>
        <label><span>Video mode</span><select id="call-quality-select">${mediaProfileOptions()}</select></label>
        <p id="call-quality-description" class="muted compact-copy"></p>
        <label><span>Voice mode</span><select id="call-audio-quality-select">${audioProfileOptions()}</select></label>
        <p id="call-audio-quality-description" class="muted compact-copy"></p>
        <p id="call-quality-runtime" class="muted compact-copy quality-runtime"></p>
        <label><span>Screen sharing</span><select id="screen-profile-select"><option value="text">Text and slides</option><option value="motion">Smooth motion</option></select></label>
        <button id="panel-toggle-share" class="secondary panel-action" type="button">Share screen</button>
        <label><span>Microphone</span><select id="call-microphone-select"></select></label>
        <label><span>Speaker</span><select id="call-speaker-select"></select></label>
        <label><span>Camera</span><select id="call-camera-select"></select></label>
        <label class="checkbox-label"><input id="call-mirror-preview" type="checkbox" /><span>Mirror my self-view</span></label>
        <button id="flip-camera" class="secondary panel-action" type="button">Flip front / rear camera</button>
      </aside>
      <p id="call-message" class="call-message" role="status" aria-live="polite"></p>
    </main>`;

  const callContent = required<HTMLElement>('#call-content');
  const grid = required<HTMLElement>('#participant-grid');
  const screenStage = required<HTMLElement>('#screen-stage');
  const stageHeading = required<HTMLElement>('#stage-heading');
  const screenMedia = required<HTMLElement>('#screen-media');
  const audioContainer = required<HTMLElement>('#audio-container');
  const statePill = required<HTMLElement>('#call-state');
  const messageBox = required<HTMLElement>('#call-message');
  const micButton = required<HTMLButtonElement>('#toggle-mic');
  const cameraButton = required<HTMLButtonElement>('#toggle-camera');
  const audioOnlyButton = required<HTMLButtonElement>('#toggle-audio-only');
  const shareButton = required<HTMLButtonElement>('#toggle-share');
  const settingsButton = required<HTMLButtonElement>('#toggle-settings');
  const resumeAudioButton = required<HTMLButtonElement>('#resume-audio');
  const leaveButton = required<HTMLButtonElement>('#leave-call');
  const copyButton = required<HTMLButtonElement>('#copy-link');
  const settingsPanel = required<HTMLElement>('#settings-panel');
  const closeSettingsButton = required<HTMLButtonElement>('#close-settings');
  const qualitySelect = required<HTMLSelectElement>('#call-quality-select');
  const audioQualitySelect = required<HTMLSelectElement>('#call-audio-quality-select');
  const qualityDescription = required<HTMLElement>('#call-quality-description');
  const audioQualityDescription = required<HTMLElement>('#call-audio-quality-description');
  const qualityRuntime = required<HTMLElement>('#call-quality-runtime');
  const screenProfileSelect = required<HTMLSelectElement>('#screen-profile-select');
  const panelShareButton = required<HTMLButtonElement>('#panel-toggle-share');
  const micSelect = required<HTMLSelectElement>('#call-microphone-select');
  const speakerSelect = required<HTMLSelectElement>('#call-speaker-select');
  const cameraSelect = required<HTMLSelectElement>('#call-camera-select');
  const mirrorCheckbox = required<HTMLInputElement>('#call-mirror-preview');
  const flipButton = required<HTMLButtonElement>('#flip-camera');

  let activeProfile = mediaProfile(options.initialProfileID);
  let activeAudioProfile = audioProfile(options.initialAudioProfileID);
  let lastVideoProfile = activeProfile.audioOnly ? mediaProfile('balanced') : activeProfile;
  let screenProfile = 'text' as ScreenProfileID;
  let cameraFacing = options.cameraFacing;
  let mirrorSelfView = options.mirrorSelfView;
  let restoreCameraAfterAudioOnly = options.startWithCamera;
  let activeSpeakerIDs = new Set<string>();
  let closedIntentionally = false;
  let didApplyInitialDevices = false;
  const tiles = new Map<string, TileEntry>();
  const screenTiles = new Map<string, ScreenTileEntry>();
  const attachedAudio = new Map<string, { element: HTMLMediaElement; track: RemoteTrack }>();
  const attachedVideo = new Map<HTMLMediaElement, Track>();

  qualitySelect.value = activeProfile.id;
  audioQualitySelect.value = activeAudioProfile.id;
  mirrorCheckbox.checked = mirrorSelfView;
  qualityDescription.textContent = `${activeProfile.description}. Target: ${profileTargetLabel(activeProfile)}.`;
  audioQualityDescription.textContent = `${activeAudioProfile.description}. Publish: ${audioProfileTargetLabel(activeAudioProfile)}.`;

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 24 } },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: audioPublishOptions(activeAudioProfile),
  });

  const attachVideo = (track: Track, muted: boolean, mirror = false): HTMLVideoElement => {
    const element = track.attach() as HTMLVideoElement;
    element.autoplay = true;
    element.playsInline = true;
    element.muted = muted;
    element.classList.toggle('mirror', mirror);
    attachedVideo.set(element, track);
    return element;
  };

  const detachVideoElement = (element?: HTMLVideoElement): void => {
    if (!element) return;
    attachedVideo.get(element)?.detach(element);
    attachedVideo.delete(element);
    element.remove();
  };

  const ensureTile = (participant: Participant, local: boolean): TileEntry => {
    const existing = tiles.get(participant.identity);
    if (existing) return existing;
    const element = document.createElement('article');
    element.className = 'participant-tile';
    element.dataset.identity = participant.identity;
    if (local) element.classList.add('local');
    const media = document.createElement('div');
    media.className = 'tile-media';
    const caption = document.createElement('div');
    caption.className = 'tile-caption';
    const label = document.createElement('strong');
    const signals = document.createElement('span');
    signals.className = 'tile-signals';
    caption.append(label, signals);
    element.append(media, caption);
    const created = { element, media, label, signals };
    tiles.set(participant.identity, created);
    return created;
  };

  const updateTile = (participant: Participant, local: boolean): TileEntry => {
    const tile = ensureTile(participant, local);
    tile.element.classList.toggle('speaking', activeSpeakerIDs.has(participant.identity));
    tile.label.textContent = local ? `${participant.name || options.displayName} (you)` : participant.name || 'Guest';
    tile.signals.textContent = `${participant.isMicrophoneEnabled ? 'mic' : 'muted'} · ${qualityLabel(participant.connectionQuality)}`;
    const camera = participant.getTrackPublication(Track.Source.Camera);
    const nextTrack = camera?.track && !camera.isMuted ? camera.track : undefined;
    if (tile.track !== nextTrack || (tile.video && !tile.media.contains(tile.video))) {
      detachVideoElement(tile.video);
      tile.video = undefined;
      tile.track = nextTrack;
      tile.media.replaceChildren();
      if (nextTrack) {
        tile.video = attachVideo(nextTrack, local, local && mirrorSelfView && cameraFacing === 'user');
        tile.media.appendChild(tile.video);
      } else {
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = initials(participant.name || participant.identity);
        tile.media.appendChild(avatar);
      }
    } else if (local && tile.video) {
      tile.video.classList.toggle('mirror', mirrorSelfView && cameraFacing === 'user');
    }
    return tile;
  };

  const updateStage = (participants: Participant[]): void => {
    const shares = participants.flatMap((participant) => {
      const publication = participant.getTrackPublication(Track.Source.ScreenShare);
      return publication?.track && !publication.isMuted ? [{ participant, track: publication.track }] : [];
    });
    const activeKeys = new Set(shares.map(({ participant }) => participant.identity));
    for (const [identity, tile] of screenTiles.entries()) {
      if (activeKeys.has(identity)) continue;
      detachVideoElement(tile.video);
      tile.element.remove();
      screenTiles.delete(identity);
    }
    shares.forEach(({ participant, track }) => {
      let tile = screenTiles.get(participant.identity);
      if (!tile) {
        const element = document.createElement('article');
        element.className = 'screen-share-tile';
        const media = document.createElement('div');
        media.className = 'screen-share-video';
        const label = document.createElement('strong');
        label.className = 'screen-share-label';
        element.append(media, label);
        tile = { element, media, label };
        screenTiles.set(participant.identity, tile);
      }
      tile.label.textContent = participant === room.localParticipant ? 'Your screen' : `${participant.name || 'Guest'} · screen`;
      if (tile.track !== track || (tile.video && !tile.media.contains(tile.video))) {
        detachVideoElement(tile.video);
        tile.track = track;
        tile.video = attachVideo(track, participant === room.localParticipant);
        tile.media.replaceChildren(tile.video);
      }
      screenMedia.appendChild(tile.element);
    });
    screenMedia.dataset.count = String(shares.length);
    stageHeading.textContent = shares.length > 1 ? `Screen shares · ${shares.length}` : 'Screen share';
    screenStage.hidden = shares.length === 0;
    callContent.classList.toggle('has-screen-share', shares.length > 0);
    window.requestAnimationFrame(updateGridLayout);
  };

  const updateGridLayout = (): void => {
    const count = Math.max(1, tiles.size);
    const width = grid.clientWidth || window.innerWidth;
    const height = grid.clientHeight || Math.max(220, window.innerHeight - grid.getBoundingClientRect().top - 96);
    const layout = chooseGridLayout(count, width, height);
    grid.style.setProperty('--grid-cols', String(layout.columns));
    grid.style.setProperty('--grid-rows', String(layout.rows));
  };

  const attachAudio = (track: RemoteTrack): void => {
    if (track.kind !== Track.Kind.Audio || !track.sid || attachedAudio.has(track.sid)) return;
    const element = track.attach();
    element.autoplay = true;
    attachedAudio.set(track.sid, { element, track });
    audioContainer.appendChild(element);
  };

  const detachTrack = (track: Track): void => {
    if (track.sid) {
      const audio = attachedAudio.get(track.sid);
      if (audio) { track.detach(audio.element); audio.element.remove(); attachedAudio.delete(track.sid); }
    }
    for (const [element, attachedTrack] of attachedVideo.entries()) {
      if (attachedTrack === track) { attachedTrack.detach(element); attachedVideo.delete(element); element.remove(); }
    }
  };

  const syncExistingAudio = (): void => {
    const activeTrackIDs = new Set<string>();
    room.remoteParticipants.forEach((participant) => participant.audioTrackPublications.forEach((publication) => {
      if (publication.track?.sid) { activeTrackIDs.add(publication.track.sid); attachAudio(publication.track as RemoteTrack); }
    }));
    for (const [sid, audio] of attachedAudio.entries()) {
      if (!activeTrackIDs.has(sid)) { audio.track.detach(audio.element); audio.element.remove(); attachedAudio.delete(sid); }
    }
  };

  const syncRemoteVideoSubscriptions = (): void => {
    room.remoteParticipants.forEach((participant) => participant.videoTrackPublications.forEach((publication) => {
      (publication as RemoteTrackPublication).setSubscribed(!activeProfile.audioOnly);
    }));
  };

  const reconcile = (): void => {
    const participants: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const identities = new Set(participants.map((participant) => participant.identity));
    for (const [identity, tile] of tiles.entries()) {
      if (!identities.has(identity)) { detachVideoElement(tile.video); tile.element.remove(); tiles.delete(identity); }
    }
    participants.forEach((participant) => grid.appendChild(updateTile(participant, participant === room.localParticipant).element));
    updateStage(participants);
    syncExistingAudio();
    micButton.textContent = room.localParticipant.isMicrophoneEnabled ? 'Mute' : 'Unmute';
    cameraButton.textContent = room.localParticipant.isCameraEnabled ? 'Camera off' : 'Camera on';
    shareButton.textContent = room.localParticipant.isScreenShareEnabled ? 'Stop sharing' : 'Share screen';
    panelShareButton.textContent = shareButton.textContent;
    audioOnlyButton.textContent = activeProfile.audioOnly ? 'Restore video' : 'Audio only';
    qualitySelect.value = activeProfile.id;
    audioQualitySelect.value = activeAudioProfile.id;
    qualityDescription.textContent = `${activeProfile.description}. Target: ${profileTargetLabel(activeProfile)}.`;
    audioQualityDescription.textContent = `${activeAudioProfile.description}. Publish: ${audioProfileTargetLabel(activeAudioProfile)}.`;
    updateGridLayout();
  };

  const refreshDevices = async (): Promise<void> => {
    const devices = await listDevices();
    updateDeviceSelect(micSelect, devices.microphones, 'Default microphone', didApplyInitialDevices ? '' : options.microphoneID);
    updateDeviceSelect(speakerSelect, devices.speakers, 'Default speaker', didApplyInitialDevices ? '' : options.speakerID);
    updateDeviceSelect(cameraSelect, devices.cameras, 'Default camera', didApplyInitialDevices ? '' : options.cameraID);
    didApplyInitialDevices = true;
    speakerSelect.disabled = !supportsOutputSelection();
  };

  const activeCameraTrack = (): LocalVideoTrack | undefined => room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
  const activeMicrophoneTrack = (): LocalAudioTrack | undefined => room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;

  const cameraCaptureLabel = (track: LocalVideoTrack): string => {
    const settings = track.mediaStreamTrack.getSettings();
    if (!settings.width || !settings.height) return 'capture settings unavailable';
    const fps = settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : '';
    return `${settings.width}×${settings.height}${fps}`;
  };

  const cameraLimitLabel = (track: LocalVideoTrack): string => {
    const settings = track.mediaStreamTrack.getSettings();
    if (!settings.width || !settings.height) return '';
    const belowTarget = settings.width < activeProfile.width || settings.height < activeProfile.height
      || Boolean(settings.frameRate && settings.frameRate + 0.5 < activeProfile.fps);
    return belowTarget ? ' Device/browser capped capture below the requested target.' : '';
  };

  const microphoneCaptureLabel = (): string => {
    const settings = activeMicrophoneTrack()?.mediaStreamTrack.getSettings();
    if (!settings) return 'microphone off';
    const sampleRate = settings.sampleRate ? `${Math.round(settings.sampleRate / 1000)}kHz` : 'sample rate unavailable';
    const channels = settings.channelCount ? `${settings.channelCount}ch` : 'mono requested';
    return `${sampleRate} · ${channels}`;
  };

  const refreshQualityRuntime = async (): Promise<void> => {
    if (activeProfile.audioOnly) {
      qualityRuntime.textContent = `Video: audio only. Camera publishing and incoming remote video are disabled locally. Voice: ${activeAudioProfile.label} · ${audioProfileTargetLabel(activeAudioProfile)} · capture ${microphoneCaptureLabel()}.`;
      return;
    }
    const track = activeCameraTrack();
    if (!track) {
      qualityRuntime.textContent = `Video selected: ${activeProfile.label}. Camera is off. Requested: ${profileTargetLabel(activeProfile)}. Voice: ${activeAudioProfile.label} · ${audioProfileTargetLabel(activeAudioProfile)} · capture ${microphoneCaptureLabel()}.`;
      return;
    }
    let outbound = '';
    try {
      const stats = await track.getSenderStats();
      const activeLayers = stats.filter((layer) => (layer.framesPerSecond ?? 0) > 0 || (layer.bytesSent ?? 0) > 0);
      const topLayer = activeLayers.sort((a, b) => (b.frameWidth ?? 0) - (a.frameWidth ?? 0))[0];
      if (topLayer?.frameWidth && topLayer.frameHeight) {
        const fps = topLayer.framesPerSecond ? ` @ ${Math.round(topLayer.framesPerSecond)}fps` : '';
        outbound = ` Outbound top layer: ${topLayer.frameWidth}×${topLayer.frameHeight}${fps}.`;
      }
    } catch {
      // Capture settings still prove which mode was applied when sender stats are unavailable.
    }
    qualityRuntime.textContent = `Video selected: ${activeProfile.label}. Requested: ${profileTargetLabel(activeProfile)}. Actual camera: ${cameraCaptureLabel(track)}.${cameraLimitLabel(track)}${outbound} Voice: ${activeAudioProfile.label} · ${audioProfileTargetLabel(activeAudioProfile)} · capture ${microphoneCaptureLabel()}.`;
  };

  const disableMicrophone = async (): Promise<void> => {
    const track = activeMicrophoneTrack();
    if (!track) return;
    await room.localParticipant.unpublishTrack(track, true);
  };

  const publishMicrophone = async (): Promise<void> => {
    const track = await createLocalAudioTrack(audioCaptureOptions(micSelect.value));
    try { await room.localParticipant.publishTrack(track, { ...audioPublishOptions(activeAudioProfile), source: Track.Source.Microphone }); }
    catch (error) { track.stop(); throw error; }
  };

  const replaceActiveMicrophone = async (): Promise<void> => {
    await disableMicrophone();
    await publishMicrophone();
  };

  const disableCamera = async (): Promise<void> => {
    const track = activeCameraTrack();
    if (!track) return;
    await room.localParticipant.unpublishTrack(track, true);
  };

  const publishCamera = async (): Promise<void> => {
    if (activeProfile.audioOnly) return;
    const track = await createLocalVideoTrack(videoCaptureOptions(cameraSelect.value, cameraFacing, activeProfile));
    try {
      await room.localParticipant.publishTrack(track, { ...cameraPublishOptions(activeProfile), source: Track.Source.Camera });
      await track.setDegradationPreference(activeProfile.degradationPreference);
    } catch (error) {
      track.stop();
      throw error;
    }
  };

  const replaceActiveCamera = async (): Promise<void> => {
    await disableCamera();
    await publishCamera();
  };

  const enableCamera = async (): Promise<void> => {
    if (activeProfile.audioOnly) return;
    if (activeCameraTrack()) await disableCamera();
    await publishCamera();
  };

  const applyProfileChange = async (id: MediaProfileID): Promise<void> => {
    const previous = activeProfile;
    const requested = mediaProfile(id);
    const hadCamera = Boolean(activeCameraTrack());
    activeProfile = requested;
    window.localStorage.setItem('plaincall.mediaProfile', activeProfile.id);
    qualityDescription.textContent = `${activeProfile.description}. Target: ${profileTargetLabel(activeProfile)}.`;
    try {
      if (!activeProfile.audioOnly) lastVideoProfile = activeProfile;
      if (activeProfile.audioOnly) {
        restoreCameraAfterAudioOnly = hadCamera;
        if (restoreCameraAfterAudioOnly) await disableCamera();
      } else if (previous.audioOnly && restoreCameraAfterAudioOnly) {
        await publishCamera();
      } else if (hadCamera) {
        await replaceActiveCamera();
      }
      syncRemoteVideoSubscriptions();
      reconcile();
      await refreshQualityRuntime();
    } catch (error) {
      activeProfile = previous;
      window.localStorage.setItem('plaincall.mediaProfile', previous.id);
      qualitySelect.value = previous.id;
      qualityDescription.textContent = `${previous.description}. Target: ${profileTargetLabel(previous)}.`;
      if (hadCamera && !activeCameraTrack() && !previous.audioOnly) {
        try { await publishCamera(); } catch { /* Keep the original profile selected even if camera recovery fails. */ }
      }
      syncRemoteVideoSubscriptions();
      reconcile();
      await refreshQualityRuntime();
      throw new Error(`Could not apply ${requested.label}: ${message(error)}`);
    }
  };

  let profileChangeChain = Promise.resolve();
  const changeProfile = (id: MediaProfileID): Promise<void> => {
    const next = profileChangeChain.then(() => applyProfileChange(id));
    profileChangeChain = next.catch(() => undefined);
    return next;
  };

  const applyAudioProfileChange = async (id: AudioProfileID): Promise<void> => {
    const previous = activeAudioProfile;
    const requested = audioProfile(id);
    const wasEnabled = room.localParticipant.isMicrophoneEnabled;
    activeAudioProfile = requested;
    window.localStorage.setItem('plaincall.audioProfile', requested.id);
    audioQualityDescription.textContent = `${requested.description}. Publish: ${audioProfileTargetLabel(requested)}.`;
    try {
      if (activeMicrophoneTrack()) await disableMicrophone();
      if (wasEnabled) await publishMicrophone();
      await refreshQualityRuntime();
    } catch (error) {
      activeAudioProfile = previous;
      window.localStorage.setItem('plaincall.audioProfile', previous.id);
      audioQualitySelect.value = previous.id;
      audioQualityDescription.textContent = `${previous.description}. Publish: ${audioProfileTargetLabel(previous)}.`;
      if (wasEnabled && !activeMicrophoneTrack()) {
        try { await publishMicrophone(); } catch { /* Keep the previous profile selected even if recovery fails. */ }
      }
      await refreshQualityRuntime();
      throw new Error(`Could not apply ${requested.label}: ${message(error)}`);
    }
  };

  let audioProfileChangeChain = Promise.resolve();
  const changeAudioProfile = (id: AudioProfileID): Promise<void> => {
    const next = audioProfileChangeChain.then(() => applyAudioProfileChange(id));
    audioProfileChangeChain = next.catch(() => undefined);
    return next;
  };

  const toggleShare = async (): Promise<void> => {
    await room.localParticipant.setScreenShareEnabled(
      !room.localParticipant.isScreenShareEnabled,
      screenCaptureOptions(screenProfile),
      screenPublishOptions(screenProfile),
    );
    reconcile();
  };

  room
    .on(RoomEvent.ParticipantConnected, () => { syncRemoteVideoSubscriptions(); reconcile(); })
    .on(RoomEvent.ParticipantDisconnected, reconcile)
    .on(RoomEvent.TrackPublished, () => { syncRemoteVideoSubscriptions(); reconcile(); })
    .on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) attachAudio(track); syncRemoteVideoSubscriptions(); reconcile(); })
    .on(RoomEvent.TrackUnsubscribed, (track) => { detachTrack(track); reconcile(); })
    .on(RoomEvent.LocalTrackPublished, reconcile)
    .on(RoomEvent.LocalTrackUnpublished, (publication) => { if (publication.track) detachTrack(publication.track); reconcile(); })
    .on(RoomEvent.TrackMuted, reconcile)
    .on(RoomEvent.TrackUnmuted, reconcile)
    .on(RoomEvent.ActiveSpeakersChanged, (participants) => { activeSpeakerIDs = new Set(participants.map((p) => p.identity)); reconcile(); })
    .on(RoomEvent.ConnectionQualityChanged, reconcile)
    .on(RoomEvent.ConnectionStateChanged, (state) => updateConnectionState(statePill, state))
    .on(RoomEvent.Reconnecting, () => setCallMessage(messageBox, 'Connection interrupted. Reconnecting…', 'warn'))
    .on(RoomEvent.Reconnected, () => setCallMessage(messageBox, 'Connection restored.', 'success', true))
    .on(RoomEvent.AudioPlaybackStatusChanged, () => { resumeAudioButton.hidden = room.canPlaybackAudio; })
    .on(RoomEvent.MediaDevicesChanged, () => refreshDevices().catch(() => undefined))
    .on(RoomEvent.LocalAudioSilenceDetected, () => setCallMessage(messageBox, 'Your microphone appears silent. Check your selected device.', 'warn'))
    .on(RoomEvent.Disconnected, () => {
      if (!closedIntentionally) setCallMessage(messageBox, 'The call disconnected. Return home and join again.', 'error');
      statePill.textContent = 'Disconnected';
      statePill.className = 'pill error';
    });

  const resizeObserver = new ResizeObserver(updateGridLayout);
  resizeObserver.observe(grid);
  window.addEventListener('resize', updateGridLayout);

  updateConnectionState(statePill, ConnectionState.Connecting);
  room.prepareConnection(options.credentials.server_url, options.credentials.participant_token);
  try { await room.connect(options.credentials.server_url, options.credentials.participant_token); }
  catch (error) { room.disconnect(); renderCallFailure(message(error)); return; }
  await room.startAudio().catch(() => { resumeAudioButton.hidden = false; });
  await room.localParticipant.setMicrophoneEnabled(true, audioCaptureOptions(options.microphoneID), audioPublishOptions(activeAudioProfile))
    .catch((error) => setCallMessage(messageBox, deviceErrorMessage(error), 'error'));
  if (options.startWithCamera && !activeProfile.audioOnly) {
    await enableCamera().catch((error) => setCallMessage(messageBox, deviceErrorMessage(error), 'error'));
  }
  if (options.speakerID && supportsOutputSelection()) await room.switchActiveDevice('audiooutput', options.speakerID).catch(() => false);
  await refreshDevices().catch(() => undefined);
  syncRemoteVideoSubscriptions();
  updateConnectionState(statePill, room.state);
  reconcile();
  await refreshQualityRuntime();
  const qualityRuntimeTimer = window.setInterval(() => { void refreshQualityRuntime(); }, 2_000);

  micButton.addEventListener('click', async () => {
    setButtonBusy(micButton, true, 'Working…');
    try { await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled, audioCaptureOptions(micSelect.value), audioPublishOptions(activeAudioProfile)); }
    catch (error) { setCallMessage(messageBox, deviceErrorMessage(error), 'error'); }
    finally { micButton.disabled = false; reconcile(); }
  });

  cameraButton.addEventListener('click', async () => {
    setButtonBusy(cameraButton, true, 'Working…');
    try {
      if (activeCameraTrack()) await disableCamera();
      else {
        if (activeProfile.audioOnly) await changeProfile(lastVideoProfile.id);
        await enableCamera();
      }
    } catch (error) { setCallMessage(messageBox, deviceErrorMessage(error), 'error'); }
    finally { cameraButton.disabled = false; reconcile(); }
  });

  audioOnlyButton.addEventListener('click', async () => {
    setButtonBusy(audioOnlyButton, true, 'Working…');
    try { await changeProfile(activeProfile.audioOnly ? lastVideoProfile.id : 'audio-only'); }
    catch (error) { setCallMessage(messageBox, message(error), 'error'); }
    finally { audioOnlyButton.disabled = false; reconcile(); }
  });

  const shareClick = async (button: HTMLButtonElement): Promise<void> => {
    setButtonBusy(button, true, 'Working…');
    try { await toggleShare(); }
    catch (error) { setCallMessage(messageBox, deviceErrorMessage(error), 'error'); }
    finally { button.disabled = false; reconcile(); }
  };
  shareButton.addEventListener('click', () => { void shareClick(shareButton); });
  panelShareButton.addEventListener('click', () => { void shareClick(panelShareButton); });

  copyButton.addEventListener('click', async () => {
    const link = inviteURL(options.roomCode);
    try { await navigator.clipboard.writeText(link); setCallMessage(messageBox, 'Invite link copied.', 'success', true); }
    catch { setCallMessage(messageBox, `Invite link: ${link}`, 'warn'); }
  });

  settingsButton.addEventListener('click', () => { settingsPanel.hidden = !settingsPanel.hidden; });
  closeSettingsButton.addEventListener('click', () => { settingsPanel.hidden = true; });
  qualitySelect.addEventListener('change', async () => {
    qualitySelect.disabled = true;
    qualityRuntime.textContent = `Applying ${mediaProfile(qualitySelect.value).label}…`;
    try {
      await changeProfile(qualitySelect.value as MediaProfileID);
      setCallMessage(messageBox, `Applied ${activeProfile.label}.`, 'success', true);
    } catch (error) {
      setCallMessage(messageBox, message(error), 'error');
      await refreshQualityRuntime();
    } finally {
      qualitySelect.disabled = false;
      reconcile();
    }
  });
  audioQualitySelect.addEventListener('change', async () => {
    audioQualitySelect.disabled = true;
    qualityRuntime.textContent = `Applying ${audioProfile(audioQualitySelect.value).label}…`;
    try {
      await changeAudioProfile(audioQualitySelect.value as AudioProfileID);
      setCallMessage(messageBox, `Applied ${activeAudioProfile.label}.`, 'success', true);
    } catch (error) {
      setCallMessage(messageBox, message(error), 'error');
      await refreshQualityRuntime();
    } finally {
      audioQualitySelect.disabled = false;
      reconcile();
    }
  });
  screenProfileSelect.addEventListener('change', () => { screenProfile = screenProfileSelect.value as ScreenProfileID; });
  micSelect.addEventListener('change', () => room.switchActiveDevice('audioinput', micSelect.value).catch((error) => setCallMessage(messageBox, message(error), 'error')));
  speakerSelect.addEventListener('change', () => room.switchActiveDevice('audiooutput', speakerSelect.value).catch((error) => setCallMessage(messageBox, message(error), 'error')));
  cameraSelect.addEventListener('change', async () => {
    cameraFacing = inferFacing(cameraSelect);
    try {
      if (activeCameraTrack()) await replaceActiveCamera();
      reconcile();
      await refreshQualityRuntime();
    } catch (error) { setCallMessage(messageBox, deviceErrorMessage(error), 'error'); }
  });
  mirrorCheckbox.addEventListener('change', () => {
    mirrorSelfView = mirrorCheckbox.checked;
    window.localStorage.setItem('plaincall.mirrorSelfView', String(mirrorSelfView));
    reconcile();
  });
  flipButton.addEventListener('click', async () => {
    cameraFacing = cameraFacing === 'user' ? 'environment' : 'user';
    cameraSelect.value = '';
    try {
      if (activeCameraTrack()) await replaceActiveCamera();
      reconcile();
      await refreshQualityRuntime();
      setCallMessage(messageBox, `Using ${cameraFacing === 'user' ? 'front' : 'rear'} camera.`, 'success', true);
    } catch (error) { setCallMessage(messageBox, deviceErrorMessage(error), 'error'); }
  });
  resumeAudioButton.addEventListener('click', () => room.startAudio().then(() => { resumeAudioButton.hidden = true; }).catch((error) => setCallMessage(messageBox, message(error), 'error')));

  const leave = (): void => { closedIntentionally = true; window.clearInterval(qualityRuntimeTimer); resizeObserver.disconnect(); room.disconnect(); window.location.assign('/'); };
  leaveButton.addEventListener('click', leave);
  window.addEventListener('pagehide', () => { window.clearInterval(qualityRuntimeTimer); resizeObserver.disconnect(); room.disconnect(); }, { once: true });
}

function renderCallFailure(reason: string): void {
  root.innerHTML = `<main class="shell centered"><section class="card hero"><p class="eyebrow">PlainCall</p><h1>Could not connect</h1><p id="connect-failure" class="status error"></p><div class="button-row wrap"><button id="retry-call" class="primary" type="button">Try again</button><a class="button-link secondary" href="/">Return home</a></div></section></main>`;
  required<HTMLElement>('#connect-failure').textContent = reason;
  required<HTMLButtonElement>('#retry-call').addEventListener('click', () => window.location.reload());
}

function updateConnectionState(element: HTMLElement, state: ConnectionState): void {
  element.className = 'pill';
  switch (state) {
    case ConnectionState.Connected: element.textContent = 'Connected'; element.classList.add('success'); break;
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting: element.textContent = 'Reconnecting…'; element.classList.add('warn'); break;
    case ConnectionState.Connecting: element.textContent = 'Connecting…'; break;
    default: element.textContent = 'Disconnected'; element.classList.add('error');
  }
}

async function listDevices(): Promise<Devices> {
  if (!navigator.mediaDevices?.enumerateDevices) return { microphones: [], cameras: [], speakers: [] };
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    microphones: devices.filter((device) => device.kind === 'audioinput'),
    cameras: devices.filter((device) => device.kind === 'videoinput'),
    speakers: devices.filter((device) => device.kind === 'audiooutput'),
  };
}

function updateDeviceSelect(select: HTMLSelectElement, devices: MediaDeviceInfo[], fallback: string, preferred = ''): void {
  const current = preferred || select.value;
  select.replaceChildren();
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = fallback;
  select.appendChild(defaultOption);
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${fallback} ${index + 1}`;
    select.appendChild(option);
  });
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function inferFacing(select: HTMLSelectElement): CameraFacing {
  const label = select.selectedOptions[0]?.textContent?.toLowerCase() ?? '';
  return /(rear|back|environment|world)/.test(label) ? 'environment' : 'user';
}

function supportsOutputSelection(): boolean { return 'setSinkId' in HTMLMediaElement.prototype; }
function mediaProfileOptions(): string { return Object.values(MEDIA_PROFILES).map((profile) => `<option value="${profile.id}">${escapeHTML(profile.label)}</option>`).join(''); }
function audioProfileOptions(): string { return Object.values(AUDIO_PROFILES).map((profile) => `<option value="${profile.id}">${escapeHTML(profile.label)}</option>`).join(''); }
function normalizeRoomCode(raw: string): string { const trimmed = raw.trim(); return trimmed.startsWith('r.') ? trimmed : trimmed.toLowerCase().replace(/[\s-]+/g, ''); }
function formatRoomCode(raw: string): string { const code = normalizeRoomCode(raw); return code.startsWith('r.') || code.length !== 10 ? code : `${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`; }
function isUsableRoomCode(raw: string): boolean { const code = normalizeRoomCode(raw); return code.startsWith('r.') || /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/.test(code); }
function inviteURL(code: string): string { return `${window.location.origin}/join#${encodeURIComponent(formatRoomCode(code))}`; }
function parseRoomCode(): string | undefined {
  const hash = safeDecode(window.location.hash.replace(/^#/, '')).trim();
  if (hash && isUsableRoomCode(hash)) return hash;
  const legacy = window.location.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1];
  return legacy ? safeDecode(legacy) : undefined;
}
function safeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return ''; } }
function initials(name: string): string { return (name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?').slice(0, 2); }
function qualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case ConnectionQuality.Excellent: return 'excellent';
    case ConnectionQuality.Good: return 'good';
    case ConnectionQuality.Poor: return 'poor';
    case ConnectionQuality.Lost: return 'offline';
    default: return 'connecting';
  }
}
function required<T extends Element>(selector: string): T { const element = document.querySelector<T>(selector); if (!element) throw new Error(`missing element: ${selector}`); return element; }
function setButtonBusy(button: HTMLButtonElement, busy: boolean, label: string): void { button.disabled = busy; button.textContent = label; }
function setStatus(element: HTMLElement, text: string, kind: 'success' | 'error' | '' = ''): void { element.textContent = text; element.className = `status ${kind}`.trim(); }
function setCallMessage(element: HTMLElement, text: string, kind: 'success' | 'warn' | 'error', transient = false): void { element.textContent = text; element.className = `call-message ${kind}`; if (transient) window.setTimeout(() => { if (element.textContent === text) element.textContent = ''; }, 3500); }
function deviceErrorMessage(error: unknown): string { if (error instanceof DOMException) { if (error.name === 'NotAllowedError') return 'Microphone or camera permission was denied.'; if (error.name === 'NotFoundError') return 'The selected microphone or camera is unavailable.'; if (error.name === 'NotReadableError') return 'The selected device is already in use or unavailable.'; } return message(error); }
function message(error: unknown): string { return error instanceof Error ? error.message : 'Unexpected error.'; }
function loadBoolean(key: string, fallback: boolean): boolean { const value = window.localStorage.getItem(key); return value === null ? fallback : value === 'true'; }
function escapeHTML(value: string): string { const span = document.createElement('span'); span.textContent = value; return span.innerHTML; }
function startAudioMeter(stream: MediaStream, target: HTMLElement): () => void {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const values = new Uint8Array(analyser.frequencyBinCount);
  let animation = 0;
  const tick = (): void => { analyser.getByteFrequencyData(values); const average = values.reduce((sum, value) => sum + value, 0) / values.length; target.style.width = `${Math.min(100, Math.round(average * 1.7))}%`; animation = requestAnimationFrame(tick); };
  tick();
  return () => { cancelAnimationFrame(animation); source.disconnect(); analyser.disconnect(); void context.close(); };
}
async function postJSON<T>(url: string, body: object): Promise<T> { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const payload = await response.json().catch(() => ({})) as { error?: string } & T; if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`); return payload; }
