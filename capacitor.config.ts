import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sentryfi.app',
  appName: 'SentryFi',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
  },
};

export default config;
