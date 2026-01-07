'use client';

import { useEffect, useState } from 'react';

interface LoadingScreenProps {
  progress: number;
  status: string;
}

export function LoadingScreen({ progress, status }: LoadingScreenProps) {
  const [dots, setDots] = useState('');

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-slate-900 to-black flex items-center justify-center z-50">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-void-800/20 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-void-700/20 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-void-600/20 rounded-full" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 p-8">
        {/* Logo/Title */}
        <div className="text-center">
          <h1 className="text-6xl font-bold tracking-wider mb-2">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              VOIDSTRIKE
            </span>
          </h1>
          <p className="text-void-400 text-sm tracking-widest uppercase">
            Prepare for Battle
          </p>
        </div>

        {/* Loading bar container */}
        <div className="w-80 space-y-3">
          {/* Progress bar */}
          <div className="relative h-2 bg-void-900 rounded-full overflow-hidden border border-void-700">
            {/* Animated background */}
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-void-600/30 to-transparent animate-shimmer"
              style={{
                backgroundSize: '200% 100%',
                animation: 'shimmer 2s infinite linear'
              }}
            />
            {/* Progress fill */}
            <div
              className="relative h-full bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 transition-all duration-300 ease-out rounded-full"
              style={{ width: `${progress}%` }}
            >
              {/* Glow effect */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white/50 rounded-full blur-sm" />
            </div>
          </div>

          {/* Status text */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-void-300">
              {status}{dots}
            </span>
            <span className="text-void-500 font-mono">
              {Math.round(progress)}%
            </span>
          </div>
        </div>

        {/* Tips section */}
        <div className="mt-8 text-center max-w-md">
          <p className="text-void-500 text-xs italic">
            &quot;Control is not about power. It&apos;s about precision.&quot;
          </p>
        </div>

        {/* Keyboard hints */}
        <div className="grid grid-cols-3 gap-4 mt-4 text-xs text-void-500">
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-void-800 rounded border border-void-600">A</kbd>
            <span>Attack Move</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-void-800 rounded border border-void-600">S</kbd>
            <span>Stop</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-void-800 rounded border border-void-600">H</kbd>
            <span>Hold Position</span>
          </div>
        </div>
      </div>

      {/* CSS for shimmer animation */}
      <style jsx>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}
