import { Capacitor } from '@capacitor/core';
import { ambienceLabel } from '../engine/ambience';
import { player } from '../engine/player';

// Keeps playback alive and controllable when the screen is off:
// - Media Session (lock-screen / media keys / Windows media flyout) everywhere.
// - On Android, a foreground "media playback" service so the OS doesn't freeze the app overnight.

export interface BackgroundActions {
  /** "Next" from the notification / media keys: new song, or next favourite in a rotation. */
  next(): void;
}

const NOTIFICATION_ID = 7;
const BUTTON_PLAY_PAUSE = 1;
const BUTTON_NEXT = 2;
/** android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK */
const SERVICE_TYPE_MEDIA_PLAYBACK = 2;

export function initBackground(actions: BackgroundActions): void {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (session) {
    session.setActionHandler('play', () => void player.resume());
    // Pause and stop silence everything, including ambience playing on alone overnight.
    session.setActionHandler('pause', () => player.pause());
    session.setActionHandler('stop', () => player.pause());
    session.setActionHandler('nexttrack', () => actions.next());
  }

  const android = Capacitor.getPlatform() === 'android';
  let service: typeof import('@capawesome-team/capacitor-android-foreground-service').ForegroundService | null = null;
  let serviceRunning = false;
  let lastKey = '';

  if (android) {
    void import('@capawesome-team/capacitor-android-foreground-service').then(async ({ ForegroundService, Importance }) => {
      service = ForegroundService;
      await ForegroundService.createNotificationChannel({
        id: 'playback',
        name: 'Playback',
        description: 'Shows what MusicHub is playing',
        importance: Importance.Low,
      });
      await ForegroundService.addListener('buttonClicked', ({ buttonId }) => {
        if (buttonId === BUTTON_PLAY_PAUSE) player.mediaToggle();
        if (buttonId === BUTTON_NEXT) actions.next();
      });
      sync();
    });
  }

  function sync() {
    const { status, current, ambience } = player.getState();
    const music = status === 'playing' || status === 'loading';
    // Ambience started on its own keeps the session and service alive.
    const active = music || !!ambience;
    const space = music ? current?.space : (ambience?.space ?? current?.space);
    const spaceLabel = space === 'sleep' ? 'Sleep' : 'Think';
    const title = !music && ambience ? ambienceLabel(ambience.kind, ambience.space) : current?.title;

    if (session) {
      session.playbackState = active ? 'playing' : current ? 'paused' : 'none';
      if (title) {
        session.metadata = new MediaMetadata({
          title,
          artist: `MusicHub · ${spaceLabel}`,
          artwork: [{ src: `${import.meta.env.BASE_URL}icon.svg`, sizes: '512x512', type: 'image/svg+xml' }],
        });
      }
    }

    if (!service) return;
    const key = `${active}|${title}`;
    if (key === lastKey) return;
    lastKey = key;
    if (title) {
      const options = {
        id: NOTIFICATION_ID,
        title,
        body: active ? `Playing · ${spaceLabel}` : `Paused · ${spaceLabel}`,
        smallIcon: 'ic_stat_music',
        silent: true,
        notificationChannelId: 'playback',
        serviceType: SERVICE_TYPE_MEDIA_PLAYBACK as never,
        buttons: [
          { id: BUTTON_PLAY_PAUSE, title: active ? 'Pause' : 'Play' },
          { id: BUTTON_NEXT, title: 'Next' },
        ],
      };
      if (!serviceRunning) {
        serviceRunning = true;
        void service.requestPermissions().finally(() => service!.startForegroundService(options));
      } else {
        void service.updateForegroundService(options);
      }
    } else if (serviceRunning) {
      serviceRunning = false;
      void service.stopForegroundService();
    }
  }

  player.subscribe(sync);
}
