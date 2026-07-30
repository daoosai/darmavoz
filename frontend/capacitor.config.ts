import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.darmavoz.app',
  appName: 'Дармавоз',
  webDir: 'dist',
  backgroundColor: '#ffffff',
  plugins: {
    Keyboard: {
      resize: 'body',
      style: 'light',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
