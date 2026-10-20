import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sentryfi.app',
  appName: 'SentryFi',
  webDir: 'dist',
  android: {
    // Everything the app loads is HTTPS; never let the WebView mix in http://.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
  },
};

export default config;
