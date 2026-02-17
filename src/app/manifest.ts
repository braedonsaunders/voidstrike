import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VOIDSTRIKE',
    short_name: 'VOIDSTRIKE',
    description:
      'A competitive real-time strategy game built for the browser. Command your forces, gather resources, and dominate the battlefield.',
    start_url: '/',
    display: 'standalone',
    orientation: 'landscape',
    background_color: '#000000',
    theme_color: '#0a0015',
    categories: ['games', 'entertainment'],
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
