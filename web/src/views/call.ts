import {
  AudioPresets,
  ConnectionState,
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  LogLevel,
  Participant,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  setLogLevel,
} from 'livekit-client';
import { ApiError, endRoom, muteGuests, muteParticipant, removeParticipant, setRoomLocked, type JoinGrant } from '../api';
import {
  cameraOptions,
  deviceErrorMessage,
  isScreenShareCancelled,
  microphoneOptions,
  supportsAudioOutputSelection,
} from '../devices';
import { confirmDialog, h, setText } from '../dom';
import { icon, type IconName } from '../icons';
import { QUALITIES, cameraPublish, screenShareSettings } from '../quality';
import { roomUrl } from '../rooms';
import { storage, type DeviceChoices, type DeviceKind } from '../storage';
import { CHAT_TOPIC, SendLimiter, cleanChatText, decodeChat, encodeChat, type ChatMessage } from '../chat';
import { ChatPanel, PeoplePanel, SettingsPanel, type Panel } from './panels';
import { showMessage } from './message';
import { Stage, displayName } from './tiles';

/** Everything the call needs from the lobby. */
export interface CallInit {
  room: string;
  name: string;
  grant: JoinGrant;
  /** The member key, or empty for guests. */
  key: string;
  /** Devices already open from the preview, published as they are. */
  audio: LocalAudioTrack | undefined;
  video: LocalVideoTrack | undefined;
  choices: DeviceChoices;
  cameraOn: boolean;
  micOn: boolean;
}

type ControlState = { icon: IconName; label: string; off?: boolean; active?: boolean; disabled?: boolean };

const TOAST_MS = 5000;

// The library logs routine progress to the console, which is noise for users.
setLogLevel(LogLevel.error);

/** Joins the call and runs it until it ends. */
export async function startCall(root: HTMLElement, init: CallInit): Promise<void> {
  const { grant } = init;
  const isMember = grant.role === 'member';
  const quality = grant.quality;
  const choices = init.choices;
  let mirror = storage.getPreferences().mirror;
  let audioOnly = false;
  let memberBusy = false;
  let leaving = false;
  let ended = false;
  let frame = 0;
  let toastTimer: number | undefined;
  let wakeLock: WakeLockSentinel | undefined;

  const room = new Room({
    // Ask for the layer that matches the viewer's real screen, so text stays sharp.
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: true,
    stopLocalTrackOnUnpublish: true,
    publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, red: true, simulcast: true },
    audioCaptureDefaults: microphoneOptions(choices.audioinput),
    videoCaptureDefaults: cameraOptions(choices.videoinput, quality),
  });
  const local = room.localParticipant;

  // ---- Elements -----------------------------------------------------------

  let pinned: string | undefined;
  const stage = new Stage((identity) => {
    pinned = pinned === identity ? undefined : identity;
    schedule();
  });
  const audioSink = h('div', { hidden: true });
  const connectionBanner = h('div', { class: 'banner', role: 'status' }, 'Connecting…');
  const audioBanner = h(
    'button',
    { class: 'banner action', type: 'button', hidden: true, onclick: () => void room.startAudio() },
    'Sound is blocked by your browser. Click to turn it on.',
  );
  const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });

  const lockBadge = h('span', { class: 'chip warn', hidden: true }, icon('lock', 13), 'Locked');
  const audioOnlyBadge = h('span', { class: 'chip', hidden: true }, 'Audio only');
  const qualityLabel = QUALITIES.find((q) => q.id === quality)?.label ?? '';
  const qualityBadge = h('span', { class: 'chip', title: 'Room style' }, qualityLabel);
  const copyButton = h('button', { class: 'btn compact', type: 'button', onclick: () => void copyLink() }, icon('copy', 16), 'Copy link');

  const micButton = control();
  const cameraButton = control();
  const shareButton = control();
  const chatButton = control();
  const peopleButton = control();
  const settingsButton = control();
  const leaveButton = control('leave');
  leaveButton.classList.add('leave');
  const canShare = typeof navigator.mediaDevices.getDisplayMedia === 'function';
  shareButton.hidden = !canShare;

  const people = new PeoplePanel(
    isMember,
    {
      remove: (participant) => void removeFromCall(participant),
      mute: (participant) => void muteInCall(participant),
      muteGuests: () => void muteEveryGuest(),
      toggleLock: () => void toggleLock(),
      end: () => void endForEveryone(),
    },
    () => openPanel(null),
  );
  const settings = new SettingsPanel(
    {
      device: (kind, deviceId) => void switchDevice(kind, deviceId),
      mirror: (on) => {
        mirror = on;
        storage.setPreferences({ ...storage.getPreferences(), mirror });
        schedule();
      },
      audioOnly: (on) => void setAudioOnly(on),
    },
    mirror,
    () => openPanel(null),
  );
  const sendLimit = new SendLimiter();
  let unread = 0;
  let messageCount = 0;
  const chat = new ChatPanel(sendChat, () => openPanel(null));
  const panels: Record<'people' | 'settings' | 'chat', Panel> = { people: people.panel, settings: settings.panel, chat: chat.panel };

  root.replaceChildren(
    h(
      'div',
      { class: 'call' },
      h(
        'header',
        { class: 'topbar' },
        h('span', { class: 'room-title' }, init.room),
        qualityBadge,
        lockBadge,
        audioOnlyBadge,
        h('span', { class: 'spacer' }),
        copyButton,
      ),
      h('div', { class: 'call-body' }, stage.el, chat.panel.el, people.panel.el, settings.panel.el),
      connectionBanner,
      audioBanner,
      toastEl,
      h('footer', { class: 'controls' }, micButton, cameraButton, shareButton, chatButton, peopleButton, settingsButton, leaveButton),
      audioSink,
    ),
  );
  document.title = `${init.room} · PlainCall`;

  // ---- Rendering ----------------------------------------------------------

  /** Redraws on the next animation frame, however many events arrive before it. */
  function schedule(): void {
    if (ended || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function isLocked(): boolean {
    try {
      const metadata: unknown = JSON.parse(room.metadata || '{}');
      return typeof metadata === 'object' && metadata !== null && (metadata as { locked?: unknown }).locked === true;
    } catch {
      return false;
    }
  }

  function render(): void {
    if (pinned && pinned !== local.identity && !room.remoteParticipants.has(pinned)) pinned = undefined; // they left
    stage.update(room, { mirrorSelf: mirror, pinned });
    const locked = isLocked();
    lockBadge.hidden = !locked;
    audioOnlyBadge.hidden = !audioOnly;
    people.update(room, locked, memberBusy);

    const micOn = local.isMicrophoneEnabled;
    const cameraOn = local.isCameraEnabled;
    const sharing = local.isScreenShareEnabled;
    setControl(micButton, { icon: micOn ? 'mic' : 'micOff', label: micOn ? 'Mute' : 'Unmute', off: !micOn });
    setControl(cameraButton, {
      icon: cameraOn ? 'video' : 'videoOff',
      label: cameraOn ? 'Stop video' : 'Start video',
      off: !cameraOn,
      disabled: audioOnly,
    });
    setControl(shareButton, {
      icon: sharing ? 'monitorOff' : 'monitorUp',
      label: sharing ? 'Stop sharing' : 'Share',
      active: sharing,
    });
    setControl(chatButton, { icon: 'message', label: 'Chat', active: chat.panel.open });
    if (unread > 0) chatButton.append(h('span', { class: 'count', 'aria-label': `${unread} unread` }, unread > 9 ? '9+' : String(unread)));
    setControl(peopleButton, { icon: 'users', label: 'People', active: people.panel.open });
    const count = h('span', { class: 'count' }, String(room.remoteParticipants.size + 1));
    peopleButton.append(count);
    setControl(settingsButton, { icon: 'settings', label: 'Settings', active: settings.panel.open });
    setControl(leaveButton, { icon: 'phoneOff', label: 'Leave' });
  }

  function openPanel(which: 'people' | 'settings' | 'chat' | null): void {
    for (const [name, panel] of Object.entries(panels)) {
      panel.open = name === which && !panel.open;
    }
    if (settings.panel.open) void settings.refresh(room);
    if (chat.panel.open) {
      unread = 0;
      chat.focus();
    }
    render();
  }

  function toast(text: string, kind: 'info' | 'error' = 'info'): void {
    setText(toastEl, text);
    toastEl.className = `toast ${kind}`;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), TOAST_MS);
  }

  // ---- Everyone's actions -------------------------------------------------

  async function attempt(action: () => Promise<unknown>, failure: (error: unknown) => string): Promise<void> {
    try {
      await action();
    } catch (error) {
      toast(failure(error), 'error');
    } finally {
      schedule();
    }
  }

  const toggleMicrophone = (): Promise<void> =>
    attempt(
      () => local.setMicrophoneEnabled(!local.isMicrophoneEnabled, microphoneOptions(choices.audioinput)),
      (error) => deviceErrorMessage(error, 'microphone'),
    );

  const toggleCamera = (): Promise<void> =>
    attempt(async () => {
      const current = local.getTrackPublication(Track.Source.Camera)?.track;
      if (current) {
        // Unpublishing stops the camera, so its light goes off.
        await local.unpublishTrack(current, true);
      } else {
        await local.setCameraEnabled(
          true,
          cameraOptions(room.getActiveDevice('videoinput') ?? choices.videoinput, quality),
          cameraPublish(quality),
        );
      }
    }, (error) => deviceErrorMessage(error, 'camera'));

  const toggleShare = (): Promise<void> => {
    const { capture, publish } = screenShareSettings(quality);
    return attempt(
      () =>
        local.setScreenShareEnabled(
          !local.isScreenShareEnabled,
          {
            audio: true,
            systemAudio: 'include',
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'include',
            ...capture,
          },
          publish,
        ),
      (error) => (isScreenShareCancelled(error) ? '' : deviceErrorMessage(error, 'screen')),
    );
  };

  async function switchDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    choices[kind] = deviceId;
    storage.setDevices(choices);
    await attempt(
      async () => {
        if (!(await room.switchActiveDevice(kind, deviceId, true))) throw new Error('switch failed');
      },
      () => 'Could not switch to that device.',
    );
    void settings.refresh(room);
  }

  /** Turns off the camera and stops receiving video, or undoes that. */
  async function setAudioOnly(on: boolean): Promise<void> {
    audioOnly = on;
    settings.setAudioOnly(on);
    if (on) {
      const current = local.getTrackPublication(Track.Source.Camera)?.track;
      if (current) await attempt(() => local.unpublishTrack(current, true), () => 'Could not turn the camera off.');
    }
    for (const participant of room.remoteParticipants.values()) {
      participant.videoTrackPublications.forEach((publication) => publication.setSubscribed(!on));
    }
    schedule();
  }

  async function copyLink(): Promise<void> {
    const url = roomUrl(init.room);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied.');
    } catch {
      toast(url);
    }
  }

  /** Sends a chat message to everyone. Returns true when it went out. */
  async function sendChat(raw: string): Promise<boolean> {
    const text = cleanChatText(raw);
    if (text === null) return false;
    if (!sendLimit.allow()) {
      toast('You are sending messages too fast. Wait a moment.', 'error');
      return false;
    }
    try {
      await local.publishData(encodeChat(text), { reliable: true, topic: CHAT_TOPIC });
    } catch {
      toast('The message could not be sent.', 'error');
      return false;
    }
    chat.add(message(local, text, true));
    return true;
  }

  function message(from: Participant, text: string, mine: boolean): ChatMessage {
    return { id: ++messageCount, from: from.identity, name: displayName(from), text, at: new Date(), mine };
  }

  // ---- Member actions -----------------------------------------------------

  async function asMember(action: () => Promise<void>): Promise<void> {
    memberBusy = true;
    schedule();
    try {
      await action();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That did not work. Try again.', 'error');
    } finally {
      memberBusy = false;
      schedule();
    }
  }

  async function removeFromCall(participant: Participant): Promise<void> {
    const name = displayName(participant);
    const confirmed = await confirmDialog({
      title: `Remove ${name}?`,
      message: 'They will be disconnected. They can come back unless you lock the room.',
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    await asMember(async () => {
      await removeParticipant(init.room, participant.identity, init.key);
      toast(`${name} was removed.`);
    });
  }

  async function muteInCall(participant: Participant): Promise<void> {
    const name = displayName(participant);
    await asMember(async () => {
      await muteParticipant(init.room, participant.identity, init.key);
      toast(`${name} was muted.`);
    });
  }

  const muteEveryGuest = (): Promise<void> =>
    asMember(async () => {
      const { muted } = await muteGuests(init.room, init.key);
      toast(muted === 0 ? 'Every guest is already muted.' : muted === 1 ? '1 guest was muted.' : `${muted} guests were muted.`);
    });

  const toggleLock = (): Promise<void> => asMember(() => setRoomLocked(init.room, !isLocked(), init.key));

  async function endForEveryone(): Promise<void> {
    const confirmed = await confirmDialog({
      title: 'End the call for everyone?',
      message: 'Everyone will be disconnected. Guests cannot rejoin until a host does.',
      confirmLabel: 'End call',
    });
    if (confirmed) await asMember(() => endRoom(init.room, init.key));
  }

  // ---- Events -------------------------------------------------------------

  micButton.addEventListener('click', () => void toggleMicrophone());
  cameraButton.addEventListener('click', () => void toggleCamera());
  shareButton.addEventListener('click', () => void toggleShare());
  chatButton.addEventListener('click', () => openPanel('chat'));
  peopleButton.addEventListener('click', () => openPanel('people'));
  settingsButton.addEventListener('click', () => openPanel('settings'));
  leaveButton.addEventListener('click', () => {
    leaving = true;
    void room.disconnect();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ended) openPanel(null);
  });

  const redraw = (): void => schedule();
  room
    .on(RoomEvent.ParticipantConnected, redraw)
    .on(RoomEvent.ParticipantDisconnected, redraw)
    .on(RoomEvent.ParticipantNameChanged, redraw)
    .on(RoomEvent.ParticipantAttributesChanged, redraw)
    .on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication) => {
      if (audioOnly && publication.kind === Track.Kind.Video) publication.setSubscribed(false);
      schedule();
    })
    .on(RoomEvent.TrackUnpublished, redraw)
    .on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) audioSink.append(track.attach());
      schedule();
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((element) => element.remove());
      schedule();
    })
    .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      // Only messages from a person in the room count. LiveKit sets who sent it.
      if (topic !== CHAT_TOPIC || !participant) return;
      const text = decodeChat(payload);
      if (text === null) return;
      chat.add(message(participant, text, false));
      if (!chat.panel.open) unread++;
      schedule();
    })
    .on(RoomEvent.TrackMuted, redraw)
    .on(RoomEvent.TrackUnmuted, redraw)
    .on(RoomEvent.LocalTrackPublished, redraw)
    .on(RoomEvent.LocalTrackUnpublished, redraw)
    .on(RoomEvent.ActiveSpeakersChanged, redraw)
    .on(RoomEvent.ConnectionQualityChanged, redraw)
    .on(RoomEvent.RoomMetadataChanged, redraw)
    .on(RoomEvent.MediaDevicesChanged, () => {
      if (settings.panel.open) void settings.refresh(room);
    })
    .on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === ConnectionState.Connecting) {
        showConnection('Connecting…', false);
      } else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
        showConnection('Connection lost. Reconnecting…', true);
      } else {
        connectionBanner.hidden = true;
      }
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      audioBanner.hidden = room.canPlaybackAudio;
    })
    .on(RoomEvent.Disconnected, (reason) => finish(reason));

  function showConnection(text: string, trouble: boolean): void {
    setText(connectionBanner, text);
    connectionBanner.className = trouble ? 'banner warn' : 'banner';
    connectionBanner.hidden = false;
  }

  function finish(reason?: DisconnectReason): void {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(toastTimer);
    stage.destroy();
    releaseWakeLock();
    document.title = 'PlainCall';
    showMessage(root, { ...describeEnd(reason), action: { label: 'Rejoin', onClick: () => window.location.reload() }, home: true });
  }

  // ---- Start --------------------------------------------------------------

  try {
    await room.connect(grant.url, grant.token);
  } catch {
    init.audio?.stop();
    init.video?.stop();
    if (leaving) {
      finish(DisconnectReason.CLIENT_INITIATED);
      return;
    }
    ended = true;
    stage.destroy();
    showMessage(root, {
      title: 'Could not join the call',
      message: 'The call server could not be reached.',
      action: { label: 'Try again', onClick: () => window.location.reload() },
      home: true,
    });
    return;
  }

  // The lock is dropped whenever the page is hidden, so ask for it again.
  document.addEventListener('visibilitychange', keepAwake);
  void keepAwake();
  await publishPreviewTracks();
  if (choices.audiooutput && supportsAudioOutputSelection()) {
    await room.switchActiveDevice('audiooutput', choices.audiooutput).catch(() => false);
  }
  await room.startAudio().catch(() => {
    audioBanner.hidden = false;
  });
  render();
  void settings.refresh(room); // so the device pickers are ready when opened

  /** Publishes the microphone and camera that were open in the lobby. */
  async function publishPreviewTracks(): Promise<void> {
    if (init.audio) {
      await local
        .publishTrack(init.audio, { source: Track.Source.Microphone })
        .catch((error) => toast(deviceErrorMessage(error, 'microphone'), 'error'));
    }
    if (init.video) {
      // The preview was opened before the room's style was known. Reopen the
      // camera when the style asks for a different picture size.
      const wanted = cameraOptions(undefined, quality).resolution?.height;
      const settings = init.video.mediaStreamTrack.getSettings();
      if (wanted && settings.height && settings.height !== wanted) {
        await init.video.restartTrack(cameraOptions(settings.deviceId, quality)).catch(() => undefined);
      }
      await local
        .publishTrack(init.video, { source: Track.Source.Camera, ...cameraPublish(quality) })
        .catch((error) => toast(deviceErrorMessage(error, 'camera'), 'error'));
    }
  }

  // ---- Keeping the screen on ----------------------------------------------

  async function keepAwake(): Promise<void> {
    if (ended || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Not permitted, for example on low battery. The call works without it.
    }
  }

  function releaseWakeLock(): void {
    document.removeEventListener('visibilitychange', keepAwake);
    void wakeLock?.release().catch(() => undefined);
  }
}

function control(kind: 'default' | 'leave' = 'default'): HTMLButtonElement {
  return h('button', { class: `control ${kind === 'leave' ? 'leave' : ''}`.trim(), type: 'button' });
}

function setControl(button: HTMLButtonElement, state: ControlState): void {
  button.replaceChildren(icon(state.icon, 22), h('span', { class: 'control-label' }, state.label));
  button.classList.toggle('off', state.off === true);
  button.classList.toggle('active', state.active === true);
  button.disabled = state.disabled === true;
  button.setAttribute('aria-label', state.label);
}

function describeEnd(reason?: DisconnectReason): { title: string; message: string } {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return { title: 'You left the call', message: 'You can rejoin whenever you like.' };
    case DisconnectReason.PARTICIPANT_REMOVED:
      return { title: 'You were removed', message: 'A host removed you from the call.' };
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return { title: 'The call has ended', message: 'A host ended the call for everyone.' };
    case DisconnectReason.SERVER_SHUTDOWN:
      return { title: 'The call server restarted', message: 'Rejoin to carry on.' };
    default:
      return { title: 'Connection lost', message: 'You were disconnected from the call. Check your connection and rejoin.' };
  }
}
