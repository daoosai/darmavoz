import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || env.VITE_API_ORIGIN;

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          navigateFallbackDenylist: [/^\/api/, /^\/s3/, /^\/static/, /.*\.apk$/],
        },
        manifest: {
          name: 'Дармавоз',
          short_name: 'Дармавоз',
          description: 'Заказ нерудных материалов и спецтехники',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          lang: 'ru',
          icons: [
            {
              src: '/icons/icon-192.webp',
              sizes: '192x192',
              type: 'image/webp',
              purpose: 'any maskable',
            },
            {
              src: '/icons/icon-512.webp',
              sizes: '512x512',
              type: 'image/webp',
              purpose: 'any maskable',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
    },
    server: {
      ...(proxyTarget
        ? {
            proxy: {
              '/api/v1': {
                target: proxyTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
