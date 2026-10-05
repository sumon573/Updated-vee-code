import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-512.svg', 'icons/maskable.svg'],
      manifest: {
        name: 'Vee',
        short_name: 'Vee',
        description: 'Vee — social voice chat rooms, calls and gifting.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#07020F',
        theme_color: '#07020F',
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Voice sessions and the RTDB socket must never be cached.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // App shell / page navigations: network-first with cache fallback.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'vee-pages' },
          },
        ],
      },
      devOptions: {
        // Leave the service worker off during `vite dev` to avoid stale caches.
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
