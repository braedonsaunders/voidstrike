'use client';

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center">
      <div className="relative">
        {/* Animated logo */}
        <h1 className="font-display text-4xl md:text-6xl font-bold tracking-wider text-void-400 animate-pulse-glow">
          VOIDSTRIKE
        </h1>

        {/* Loading indicator */}
        <div className="mt-8 flex flex-col items-center">
          <div className="w-48 h-1 bg-void-900 rounded-full overflow-hidden">
            <div className="h-full bg-void-500 animate-pulse" style={{ width: '60%' }} />
          </div>
          <p className="mt-4 text-void-500 text-sm">Loading game assets...</p>
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `radial-gradient(circle at center, rgba(132,61,255,0.3) 0%, transparent 70%)`,
          }}
        />
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `linear-gradient(rgba(132,61,255,0.1) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(132,61,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />
      </div>
    </div>
  );
}
