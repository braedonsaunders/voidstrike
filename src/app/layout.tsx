import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VOIDSTRIKE - Browser-Based RTS',
  description: 'A competitive real-time strategy game built for the browser. Command your forces, gather resources, and dominate the battlefield.',
  keywords: ['RTS', 'strategy', 'game', 'browser', 'multiplayer', 'competitive'],
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
      </head>
      <body className="font-sans bg-black text-white antialiased">
        {children}
      </body>
    </html>
  );
}
