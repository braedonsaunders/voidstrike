import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';

export const metadata: Metadata = {
  title: 'VOIDSTRIKE - Browser-Based RTS',
  description:
    'A competitive real-time strategy game built for the browser. Command your forces, gather resources, and dominate the battlefield.',
  keywords: ['RTS', 'strategy', 'game', 'browser', 'multiplayer', 'competitive'],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'VOIDSTRIKE',
  },
  applicationName: 'VOIDSTRIKE',
};

export const viewport: Viewport = {
  themeColor: '#0a0015',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Orbitron:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" href="/icon-192x192.png" />
      </head>
      <body className="font-sans bg-black text-white antialiased">
        <ServiceWorkerRegistrar />
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
