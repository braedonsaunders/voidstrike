import type { Metadata } from 'next';
import { Inter, Orbitron, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const orbitron = Orbitron({ subsets: ['latin'], variable: '--font-display' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

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
      <body className={`${inter.variable} ${orbitron.variable} ${jetbrainsMono.variable} font-sans bg-black text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
