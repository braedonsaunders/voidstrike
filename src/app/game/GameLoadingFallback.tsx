interface GameLoadingFallbackProps {
  status?: string;
}

export function GameLoadingFallback({
  status = 'Preparing battlefield',
}: GameLoadingFallbackProps) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#050814] text-white">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            'radial-gradient(circle at top, rgba(91, 33, 182, 0.35), transparent 45%), radial-gradient(circle at bottom left, rgba(14, 165, 233, 0.2), transparent 35%), linear-gradient(180deg, rgba(5, 8, 20, 0.98), rgba(2, 6, 23, 1))',
        }}
      />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgba(96, 165, 250, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(96, 165, 250, 0.08) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="max-w-2xl">
          <p className="mb-3 text-xs uppercase tracking-[0.55em] text-cyan-200/70">
            Initializing Combat Systems
          </p>
          <h1
            className="text-5xl font-black tracking-[0.24em] text-transparent sm:text-6xl"
            style={{
              backgroundImage: 'linear-gradient(135deg, #60a5fa, #a855f7 50%, #22d3ee)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              filter:
                'drop-shadow(0 0 24px rgba(96, 165, 250, 0.35)) drop-shadow(0 0 48px rgba(34, 211, 238, 0.18))',
            }}
          >
            VOIDSTRIKE
          </h1>
          <p className="mt-6 text-sm tracking-[0.08em] text-slate-300/80">
            Match accepted. Establishing simulation and synchronizing battlefield state.
          </p>
        </div>

        <div className="mt-12 w-full max-w-lg rounded-2xl border border-cyan-400/15 bg-slate-950/55 px-5 py-5 backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.35em] text-cyan-200/75">
            <span>Route</span>
            <span>Worker</span>
            <span>Render</span>
            <span>Sync</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full border border-cyan-300/20 bg-slate-950/90 shadow-[inset_0_1px_8px_rgba(0,0,0,0.5)]">
            <div
              aria-label="Loading progress"
              aria-valuetext={status}
              className="h-full rounded-full"
              role="progressbar"
              style={{
                width: '42%',
                background: 'linear-gradient(90deg, #38bdf8, #818cf8 45%, #22d3ee)',
                boxShadow: '0 0 18px rgba(56, 189, 248, 0.45), 0 0 36px rgba(129, 140, 248, 0.22)',
                animation: 'game-loading-fallback-slide 1.2s ease-in-out infinite',
                transformOrigin: 'left center',
              }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 text-sm text-slate-300/85">
            <span>{status}</span>
            <span className="font-mono uppercase tracking-[0.25em] text-cyan-300/80">Live</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes game-loading-fallback-slide {
          0% {
            transform: translateX(-40%) scaleX(0.72);
            opacity: 0.65;
          }
          50% {
            transform: translateX(72%) scaleX(1);
            opacity: 1;
          }
          100% {
            transform: translateX(-40%) scaleX(0.72);
            opacity: 0.65;
          }
        }
      `}</style>
    </div>
  );
}
