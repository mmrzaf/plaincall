import { defineConfig } from '@playwright/test';

const chromiumArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  // The fake microphone beeps. The tests check that audio arrives, not how it sounds.
  '--mute-audio',
  '--auto-select-desktop-capture-source=Entire screen',
];

export default defineConfig({
  testDir: './tests',
  globalTeardown: './tests/teardown.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  projects: [
    {
      name: 'chromium',
      grepInvert: /@webkit-only/,
      use: { browserName: 'chromium', launchOptions: { args: chromiumArgs } },
    },
    {
      name: 'firefox',
      grep: /@firefox/,
      use: {
        browserName: 'firefox',
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
            'media.volume_scale': '0.0',
          },
        },
      },
    },
    {
      name: 'webkit',
      grep: /@webkit/,
      use: { browserName: 'webkit' },
    },
  ],
});
