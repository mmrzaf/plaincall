import {
  ConnectionQuality,
  ConnectionState,
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  TrackPublication,
  VideoPresets,
  type AudioCaptureOptions,
  type VideoCaptureOptions,
} from 'livekit-client';
import './styles.css';

type Devices = {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

type JoinResponse = {
  server_url: string;
  participant_token: string;
};

type CreateRoomResponse = {
  room: string;
  url: string;
  expires_at: string;
};

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('application root is missing');
const root: HTMLDivElement = appRoot;

const roomName = parseRoomName();
if (roomName) {
  renderPreJoin(roomName);
} else {
  renderLanding();
}

function renderLanding(): void {
  root.innerHTML = `
    <main class="shell centered">
      <section class="card hero">
        <p class="eyebrow">PlainCall</p>
        <h1>A room. A link. A call.</h1>
        <p class="muted">Lightweight browser calls for small teams.</p>
        <button id="start-call" class="primary large" type="button">Start a call</button>
        <p id="landing-status" class="status" role="status" aria-live="polite"></p>
      </section>
    </main>
  `;

  const startButton = required<HTMLButtonElement>('#start-call');
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
}

function renderPreJoin(room: string): void {
  root.innerHTML = `
    <main class="shell centered">
      <section class="card prejoin">
        <header>
          <a class="brand" href="/">PlainCall</a>
          <h1>Join call</h1>
          <p class="muted">Check your devices, then join.</p>
        </header>

        <div class="preview-wrap">
          <video id="preview-video" autoplay playsinline muted></video>
          <div id="preview-placeholder" class="preview-placeholder">Camera is off</div>
        </div>

        <label>
          <span>Your name</span>
          <input id="display-name" autocomplete="name" maxlength="48" placeholder="Your name" />
        </label>

        <div class="device-grid">
          <label>
            <span>Microphone</span>
            <select id="microphone-select"></select>
          </label>
          <label>
            <span>Speaker</span>
            <select id="speaker-select"></select>
          </label>
          <label>
            <span>Camera</span>
            <select id="camera-select"></select>
          </label>
        </div>

        <div class="meter" aria-label="Microphone level">
          <span id="mic-meter"></span>
        </div>

        <div class="button-row wrap">
          <button id="test-devices" class="secondary" type="button">Test devices</button>
          <button id="preview-camera" class="secondary" type="button">Enable camera preview</button>
          <button id="join-call" class="primary" type="button">Join call</button>
        </div>
        <p id="prejoin-status" class="status" role="status" aria-live="polite"></p>
      </section>
    </main>
  `;

  const nameInput = required<HTMLInputElement>('#display-name');
  const micSelect = required<HTMLSelectElement>('#microphone-select');
  const speakerSelect = required<HTMLSelectElement>('#speaker-select');
  const cameraSelect = required<HTMLSelectElement>('#camera-select');
  const testButton = required<HTMLButtonElement>('#test-devices');
  const cameraPreviewButton = required<HTMLButtonElement>('#preview-camera');
  const joinButton = required<HTMLButtonElement>('#join-call');
  const status = required<HTMLParagraphElement>('#prejoin-status');
  const previewVideo = required<HTMLVideoElement>('#preview-video');
  const previewPlaceholder = required<HTMLDivElement>('#preview-placeholder');
  const micMeter = required<HTMLSpanElement>('#mic-meter');

  nameInput.value = window.localStorage.getItem('plaincall.displayName') ?? '';
  let previewStream: MediaStream | undefined;
  let meterCleanup: (() => void) | undefined;
  let cameraPreviewEnabled = false;

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
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support microphone access.');
    }
    stopPreview();
    previewStream = await navigator.mediaDevices.getUserMedia({
      audio: browserAudioConstraints(micSelect.value),
      video: cameraPreviewEnabled ? browserVideoConstraints(cameraSelect.value) : false,
    });
    const audioTrack = previewStream.getAudioTracks()[0];
    if (audioTrack) meterCleanup = startAudioMeter(previewStream, micMeter);
    previewVideo.srcObject = previewStream;
    previewPlaceholder.hidden = cameraPreviewEnabled && previewStream.getVideoTracks().length > 0;
    await refreshDevices();
  };

  refreshDevices().catch(() => undefined);
  navigator.mediaDevices?.addEventListener('devicechange', () => refreshDevices().catch(() => undefined));

  testButton.addEventListener('click', async () => {
    setButtonBusy(testButton, true, 'Testing…');
    setStatus(status, '');
    try {
      await startPreview();
      setStatus(status, 'Microphone ready.', 'success');
    } catch (error) {
      setStatus(status, deviceErrorMessage(error), 'error');
    } finally {
      setButtonBusy(testButton, false, 'Test devices');
    }
  });

  cameraPreviewButton.addEventListener('click', async () => {
    cameraPreviewEnabled = !cameraPreviewEnabled;
    cameraPreviewButton.textContent = cameraPreviewEnabled ? 'Disable camera preview' : 'Enable camera preview';
    previewPlaceholder.hidden = false;
    previewPlaceholder.textContent = cameraPreviewEnabled ? 'Starting camera…' : 'Camera is off';
    try {
      await startPreview();
      if (!cameraPreviewEnabled) previewPlaceholder.textContent = 'Camera is off';
      setStatus(status, cameraPreviewEnabled ? 'Camera preview ready.' : 'Camera preview disabled.', 'success');
    } catch (error) {
      cameraPreviewEnabled = false;
      cameraPreviewButton.textContent = 'Enable camera preview';
      previewPlaceholder.hidden = false;
      previewPlaceholder.textContent = 'Camera is off';
      setStatus(status, deviceErrorMessage(error), 'error');
    }
  });

  joinButton.addEventListener('click', async () => {
    const displayName = nameInput.value.trim().replace(/\s+/g, ' ');
    if (!displayName) {
      setStatus(status, 'Enter your name before joining.', 'error');
      nameInput.focus();
      return;
    }
    window.localStorage.setItem('plaincall.displayName', displayName);
    setButtonBusy(joinButton, true, 'Joining…');
    setStatus(status, 'Connecting…');

    try {
      const credentials = await postJSON<JoinResponse>('/api/token', {
        room_name: room,
        participant_name: displayName,
      });
      stopPreview();
      await startCall({
        roomName: room,
        displayName,
        credentials,
        microphoneID: micSelect.value,
        speakerID: speakerSelect.value,
        cameraID: cameraSelect.value,
        startWithCamera: cameraPreviewEnabled,
      });
    } catch (error) {
      setStatus(status, message(error), 'error');
      setButtonBusy(joinButton, false, 'Join call');
    }
  });

  window.addEventListener('pagehide', stopPreview, { once: true });
}

type StartCallOptions = {
  roomName: string;
  displayName: string;
  credentials: JoinResponse;
  microphoneID: string;
  speakerID: string;
  cameraID: string;
  startWithCamera: boolean;
};

async function startCall(options: StartCallOptions): Promise<void> {
  root.innerHTML = `
    <main class="call-shell">
      <header class="call-header">
        <div>
          <a class="brand" href="/">PlainCall</a>
          <span id="call-state" class="pill">Connecting…</span>
        </div>
        <button id="copy-link" class="secondary compact" type="button">Copy invite link</button>
      </header>

      <section id="screen-stage" class="screen-stage" hidden>
        <div class="stage-heading">Screen share</div>
        <div id="screen-media" class="screen-media"></div>
      </section>

      <section id="participant-grid" class="participant-grid" aria-label="Participants"></section>
      <section id="audio-container" hidden></section>

      <footer class="control-bar">
        <button id="toggle-mic" class="control" type="button">Mute</button>
        <button id="toggle-camera" class="control" type="button">Camera on</button>
        <button id="toggle-share" class="control" type="button">Share screen</button>
        <button id="toggle-devices" class="control" type="button">Devices</button>
        <button id="resume-audio" class="control warn" type="button" hidden>Resume audio</button>
        <button id="leave-call" class="control danger" type="button">Leave</button>
      </footer>

      <aside id="devices-panel" class="devices-panel" hidden>
        <h2>Devices</h2>
        <label><span>Microphone</span><select id="call-microphone-select"></select></label>
        <label><span>Speaker</span><select id="call-speaker-select"></select></label>
        <label><span>Camera</span><select id="call-camera-select"></select></label>
        <button id="close-devices" class="secondary" type="button">Close</button>
      </aside>

      <p id="call-message" class="call-message" role="status" aria-live="polite"></p>
    </main>
  `;

  const grid = required<HTMLElement>('#participant-grid');
  const screenStage = required<HTMLElement>('#screen-stage');
  const screenMedia = required<HTMLElement>('#screen-media');
  const audioContainer = required<HTMLElement>('#audio-container');
  const statePill = required<HTMLElement>('#call-state');
  const messageBox = required<HTMLElement>('#call-message');
  const micButton = required<HTMLButtonElement>('#toggle-mic');
  const cameraButton = required<HTMLButtonElement>('#toggle-camera');
  const shareButton = required<HTMLButtonElement>('#toggle-share');
  const devicesButton = required<HTMLButtonElement>('#toggle-devices');
  const resumeAudioButton = required<HTMLButtonElement>('#resume-audio');
  const leaveButton = required<HTMLButtonElement>('#leave-call');
  const copyButton = required<HTMLButtonElement>('#copy-link');
  const devicesPanel = required<HTMLElement>('#devices-panel');
  const closeDevicesButton = required<HTMLButtonElement>('#close-devices');
  const micSelect = required<HTMLSelectElement>('#call-microphone-select');
  const speakerSelect = required<HTMLSelectElement>('#call-speaker-select');
  const cameraSelect = required<HTMLSelectElement>('#call-camera-select');

  let activeSpeakerIDs = new Set<string>();
  let closedIntentionally = false;
  const attachedAudio = new Map<string, { element: HTMLMediaElement; track: RemoteTrack }>();
  const attachedVideo = new Map<HTMLMediaElement, Track>();
  let didApplyInitialDevices = false;

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution,
      frameRate: 24,
    },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const render = (): void => {
    detachVideos(grid);
    detachVideos(screenMedia);
    grid.replaceChildren();
    screenMedia.replaceChildren();

    const participants: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    participants.forEach((participant) => grid.appendChild(participantTile(participant, participant === room.localParticipant)));

    const share = participants
      .map((participant) => ({ participant, publication: participant.getTrackPublication(Track.Source.ScreenShare) }))
      .find(({ publication }) => publication?.track && !publication.isMuted);

    if (share?.publication?.track) {
      screenStage.hidden = false;
      screenMedia.appendChild(attachVideo(share.publication.track, false));
    } else {
      screenStage.hidden = true;
    }

    syncExistingAudio();
    refreshTileStates();
    micButton.textContent = room.localParticipant.isMicrophoneEnabled ? 'Mute' : 'Unmute';
    cameraButton.textContent = room.localParticipant.isCameraEnabled ? 'Camera off' : 'Camera on';
    shareButton.textContent = room.localParticipant.isScreenShareEnabled ? 'Stop sharing' : 'Share screen';
  };

  const participantTile = (participant: Participant, local: boolean): HTMLElement => {
    const tile = document.createElement('article');
    tile.className = 'participant-tile';
    tile.dataset.identity = participant.identity;
    if (local) tile.classList.add('local');
    if (activeSpeakerIDs.has(participant.identity)) tile.classList.add('speaking');

    const media = document.createElement('div');
    media.className = 'tile-media';
    const camera = participant.getTrackPublication(Track.Source.Camera);
    if (camera?.track && !camera.isMuted) {
      media.appendChild(attachVideo(camera.track, local));
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = initials(participant.name || participant.identity);
      media.appendChild(avatar);
    }

    const caption = document.createElement('div');
    caption.className = 'tile-caption';
    const label = document.createElement('strong');
    label.textContent = local ? `${participant.name || options.displayName} (you)` : participant.name || 'Guest';
    const signals = document.createElement('span');
    signals.className = 'tile-signals';
    signals.textContent = `${participant.isMicrophoneEnabled ? 'mic' : 'muted'} · ${qualityLabel(participant.connectionQuality)}`;
    caption.append(label, signals);
    tile.append(media, caption);
    return tile;
  };

  const refreshTileStates = (): void => {
    grid.querySelectorAll<HTMLElement>('.participant-tile').forEach((tile) => {
      const identity = tile.dataset.identity;
      if (!identity) return;
      const participant = room.localParticipant.identity === identity
        ? room.localParticipant
        : room.remoteParticipants.get(identity);
      if (!participant) return;
      tile.classList.toggle('speaking', activeSpeakerIDs.has(identity));
      const signals = tile.querySelector<HTMLElement>('.tile-signals');
      if (signals) signals.textContent = `${participant.isMicrophoneEnabled ? 'mic' : 'muted'} · ${qualityLabel(participant.connectionQuality)}`;
    });
  };

  const attachVideo = (track: Track, muted: boolean): HTMLVideoElement => {
    const element = track.attach() as HTMLVideoElement;
    element.autoplay = true;
    element.playsInline = true;
    element.muted = muted;
    attachedVideo.set(element, track);
    return element;
  };

  const detachVideos = (container: HTMLElement): void => {
    container.querySelectorAll<HTMLMediaElement>('video').forEach((element) => {
      attachedVideo.get(element)?.detach(element);
      attachedVideo.delete(element);
      element.remove();
    });
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
      if (audio) {
        track.detach(audio.element);
        audio.element.remove();
        attachedAudio.delete(track.sid);
      }
    }
    for (const [element, attachedTrack] of attachedVideo.entries()) {
      if (attachedTrack === track) {
        track.detach(element);
        element.remove();
        attachedVideo.delete(element);
      }
    }
    track.detach().forEach((element) => element.remove());
  };

  const syncExistingAudio = (): void => {
    const activeTrackIDs = new Set<string>();
    room.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((publication) => {
        if (publication.track?.sid) {
          activeTrackIDs.add(publication.track.sid);
          attachAudio(publication.track as RemoteTrack);
        }
      });
    });
    for (const [sid, audio] of attachedAudio.entries()) {
      if (!activeTrackIDs.has(sid)) {
        audio.track.detach(audio.element);
        audio.element.remove();
        attachedAudio.delete(sid);
      }
    }
  };

  const refreshDevices = async (): Promise<void> => {
    const devices = await listDevices();
    updateDeviceSelect(micSelect, devices.microphones, 'Default microphone', didApplyInitialDevices ? '' : options.microphoneID);
    updateDeviceSelect(speakerSelect, devices.speakers, 'Default speaker', didApplyInitialDevices ? '' : options.speakerID);
    updateDeviceSelect(cameraSelect, devices.cameras, 'Default camera', didApplyInitialDevices ? '' : options.cameraID);
    didApplyInitialDevices = true;
    speakerSelect.disabled = !supportsOutputSelection();
  };

  room
    .on(RoomEvent.ParticipantConnected, render)
    .on(RoomEvent.ParticipantDisconnected, render)
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) attachAudio(track);
      render();
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      detachTrack(track);
      render();
    })
    .on(RoomEvent.LocalTrackPublished, render)
    .on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (publication.track) detachTrack(publication.track);
      render();
    })
    .on(RoomEvent.TrackMuted, render)
    .on(RoomEvent.TrackUnmuted, render)
    .on(RoomEvent.ActiveSpeakersChanged, (participants) => {
      activeSpeakerIDs = new Set(participants.map((participant) => participant.identity));
      refreshTileStates();
    })
    .on(RoomEvent.ConnectionQualityChanged, refreshTileStates)
    .on(RoomEvent.ConnectionStateChanged, (state) => updateConnectionState(statePill, state))
    .on(RoomEvent.Reconnecting, () => setCallMessage(messageBox, 'Connection interrupted. Reconnecting…', 'warn'))
    .on(RoomEvent.Reconnected, () => setCallMessage(messageBox, 'Connection restored.', 'success', true))
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      resumeAudioButton.hidden = room.canPlaybackAudio;
    })
    .on(RoomEvent.MediaDevicesChanged, () => refreshDevices().catch(() => undefined))
    .on(RoomEvent.LocalAudioSilenceDetected, () => setCallMessage(messageBox, 'Your microphone appears silent. Check your selected device.', 'warn'))
    .on(RoomEvent.Disconnected, () => {
      if (!closedIntentionally) setCallMessage(messageBox, 'The call disconnected. Return home and join again.', 'error');
      statePill.textContent = 'Disconnected';
      statePill.className = 'pill error';
    });

  updateConnectionState(statePill, ConnectionState.Connecting);
  room.prepareConnection(options.credentials.server_url, options.credentials.participant_token);
  try {
    await room.connect(options.credentials.server_url, options.credentials.participant_token);
  } catch (error) {
    room.disconnect();
    renderCallFailure(message(error));
    return;
  }
  await room.startAudio().catch(() => {
    resumeAudioButton.hidden = false;
  });
  await room.localParticipant.setMicrophoneEnabled(true, livekitAudioOptions(options.microphoneID)).catch((error) => {
    setCallMessage(messageBox, deviceErrorMessage(error), 'error');
  });
  if (options.startWithCamera) {
    await room.localParticipant.setCameraEnabled(true, livekitVideoOptions(options.cameraID)).catch((error) => {
      setCallMessage(messageBox, deviceErrorMessage(error), 'error');
    });
  }
  if (options.speakerID && supportsOutputSelection()) {
    await room.switchActiveDevice('audiooutput', options.speakerID).catch(() => false);
  }
  await refreshDevices().catch(() => undefined);
  syncExistingAudio();
  updateConnectionState(statePill, room.state);
  render();

  micButton.addEventListener('click', async () => {
    setButtonBusy(micButton, true, 'Working…');
    try {
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled, livekitAudioOptions(micSelect.value));
    } catch (error) {
      setCallMessage(messageBox, deviceErrorMessage(error), 'error');
    } finally {
      micButton.disabled = false;
      render();
    }
  });

  cameraButton.addEventListener('click', async () => {
    setButtonBusy(cameraButton, true, 'Working…');
    try {
      await room.localParticipant.setCameraEnabled(!room.localParticipant.isCameraEnabled, livekitVideoOptions(cameraSelect.value));
    } catch (error) {
      setCallMessage(messageBox, deviceErrorMessage(error), 'error');
    } finally {
      cameraButton.disabled = false;
      render();
    }
  });

  shareButton.addEventListener('click', async () => {
    setButtonBusy(shareButton, true, 'Working…');
    try {
      await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled, {
        audio: false,
        resolution: { width: 1920, height: 1080, frameRate: 15 },
      });
    } catch (error) {
      setCallMessage(messageBox, deviceErrorMessage(error), 'error');
    } finally {
      shareButton.disabled = false;
      render();
    }
  });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCallMessage(messageBox, 'Invite link copied.', 'success', true);
    } catch {
      setCallMessage(messageBox, `Invite link: ${window.location.href}`, 'warn');
    }
  });

  devicesButton.addEventListener('click', () => {
    devicesPanel.hidden = !devicesPanel.hidden;
  });
  closeDevicesButton.addEventListener('click', () => {
    devicesPanel.hidden = true;
  });
  micSelect.addEventListener('change', () => room.switchActiveDevice('audioinput', micSelect.value).catch((error) => setCallMessage(messageBox, message(error), 'error')));
  speakerSelect.addEventListener('change', () => room.switchActiveDevice('audiooutput', speakerSelect.value).catch((error) => setCallMessage(messageBox, message(error), 'error')));
  cameraSelect.addEventListener('change', () => room.switchActiveDevice('videoinput', cameraSelect.value).catch((error) => setCallMessage(messageBox, message(error), 'error')));
  resumeAudioButton.addEventListener('click', () => room.startAudio().then(() => { resumeAudioButton.hidden = true; }).catch((error) => setCallMessage(messageBox, message(error), 'error')));

  const leave = (): void => {
    closedIntentionally = true;
    room.disconnect();
    window.location.assign('/');
  };
  leaveButton.addEventListener('click', leave);
  window.addEventListener('pagehide', () => room.disconnect(), { once: true });
}

function renderCallFailure(reason: string): void {
  root.innerHTML = `
    <main class="shell centered">
      <section class="card hero">
        <p class="eyebrow">PlainCall</p>
        <h1>Could not connect</h1>
        <p id="connect-failure" class="status error"></p>
        <div class="button-row wrap">
          <button id="retry-call" class="primary" type="button">Try again</button>
          <a class="button-link secondary" href="/">Return home</a>
        </div>
      </section>
    </main>
  `;
  required<HTMLElement>('#connect-failure').textContent = reason;
  required<HTMLButtonElement>('#retry-call').addEventListener('click', () => window.location.reload());
}

function updateConnectionState(element: HTMLElement, state: ConnectionState): void {
  element.className = 'pill';
  switch (state) {
    case ConnectionState.Connected:
      element.textContent = 'Connected';
      element.classList.add('success');
      break;
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      element.textContent = 'Reconnecting…';
      element.classList.add('warn');
      break;
    case ConnectionState.Connecting:
      element.textContent = 'Connecting…';
      break;
    default:
      element.textContent = 'Disconnected';
      element.classList.add('error');
  }
}

async function listDevices(): Promise<Devices> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { microphones: [], cameras: [], speakers: [] };
  }
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

function supportsOutputSelection(): boolean {
  return 'setSinkId' in HTMLMediaElement.prototype;
}

function browserAudioConstraints(deviceID: string): MediaTrackConstraints {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

function browserVideoConstraints(deviceID: string): MediaTrackConstraints {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 24, max: 24 },
  };
}


function livekitAudioOptions(deviceID: string): AudioCaptureOptions {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
}

function livekitVideoOptions(deviceID: string): VideoCaptureOptions {
  return {
    deviceId: deviceID ? { exact: deviceID } : undefined,
    resolution: { width: 1280, height: 720, frameRate: 24 },
  };
}

function startAudioMeter(stream: MediaStream, target: HTMLElement): () => void {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const values = new Uint8Array(analyser.frequencyBinCount);
  let animation = 0;
  const tick = (): void => {
    analyser.getByteFrequencyData(values);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    target.style.width = `${Math.min(100, Math.round(average * 1.7))}%`;
    animation = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(animation);
    source.disconnect();
    analyser.disconnect();
    void context.close();
  };
}

async function postJSON<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}.`);
  return payload;
}

function parseRoomName(): string | undefined {
  const match = window.location.pathname.match(/^\/r\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?').slice(0, 2);
}

function qualityLabel(quality: ConnectionQuality): string {
  switch (quality) {
    case ConnectionQuality.Excellent: return 'excellent';
    case ConnectionQuality.Good: return 'good';
    case ConnectionQuality.Poor: return 'poor';
    case ConnectionQuality.Lost: return 'offline';
    default: return 'connecting';
  }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean, label: string): void {
  button.disabled = busy;
  button.textContent = label;
}

function setStatus(element: HTMLElement, text: string, kind: 'success' | 'error' | '' = ''): void {
  element.textContent = text;
  element.className = `status ${kind}`.trim();
}

function setCallMessage(element: HTMLElement, text: string, kind: 'success' | 'warn' | 'error', transient = false): void {
  element.textContent = text;
  element.className = `call-message ${kind}`;
  if (transient) window.setTimeout(() => { if (element.textContent === text) element.textContent = ''; }, 3500);
}

function deviceErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Microphone or camera permission was denied.';
    if (error.name === 'NotFoundError') return 'The selected microphone or camera is unavailable.';
    if (error.name === 'NotReadableError') return 'The selected device is already in use or unavailable.';
  }
  return message(error);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}
