'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface LoadingScreenProps {
  progress: number;
  status: string;
}

// Particle class for the animated background
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  color: string;
  layer: number; // For parallax effect
  pulsePhase: number;
}

// Nebula blob for ambient glow effects
interface NebulaBLob {
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
  pulseSpeed: number;
  phase: number;
}

// Geometric shape for sci-fi effect
interface GeometricShape {
  x: number;
  y: number;
  rotation: number;
  rotationSpeed: number;
  size: number;
  opacity: number;
  sides: number;
  color: string;
}

export function LoadingScreen({ progress, status }: LoadingScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const nebulasRef = useRef<NebulaBLob[]>([]);
  const shapesRef = useRef<GeometricShape[]>([]);
  const timeRef = useRef(0);
  const [dots, setDots] = useState('');

  // Animate dots for status text
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 350);
    return () => clearInterval(interval);
  }, []);

  // Initialize particles, nebulas, and shapes
  const initializeEffects = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];
    const nebulas: NebulaBLob[] = [];
    const shapes: GeometricShape[] = [];

    // Create layered particles (stars) - more particles for richer effect
    for (let i = 0; i < 200; i++) {
      const layer = Math.random() < 0.3 ? 0 : Math.random() < 0.6 ? 1 : 2;
      const colors = ['#60a0ff', '#a080ff', '#40ffff', '#ffffff', '#8060ff'];
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * (0.2 + layer * 0.15),
        vy: (Math.random() - 0.5) * (0.2 + layer * 0.15),
        size: Math.random() * 2 + 0.5 + layer * 0.5,
        opacity: Math.random() * 0.6 + 0.2,
        color: colors[Math.floor(Math.random() * colors.length)],
        layer,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }

    // Create nebula blobs for ambient glow
    const nebulaColors = [
      'rgba(64, 100, 255, 0.15)',
      'rgba(128, 60, 200, 0.12)',
      'rgba(40, 200, 255, 0.1)',
      'rgba(100, 40, 180, 0.12)',
      'rgba(60, 140, 255, 0.1)',
    ];
    for (let i = 0; i < 6; i++) {
      nebulas.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 150 + Math.random() * 250,
        color: nebulaColors[i % nebulaColors.length],
        opacity: 0.4 + Math.random() * 0.3,
        pulseSpeed: 0.0005 + Math.random() * 0.001,
        phase: Math.random() * Math.PI * 2,
      });
    }

    // Create geometric shapes for sci-fi feel
    for (let i = 0; i < 4; i++) {
      shapes.push({
        x: width * 0.2 + Math.random() * width * 0.6,
        y: height * 0.2 + Math.random() * height * 0.6,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.002,
        size: 60 + Math.random() * 100,
        opacity: 0.03 + Math.random() * 0.05,
        sides: Math.floor(Math.random() * 3) + 4, // 4-6 sided polygons
        color: `rgba(${100 + Math.random() * 100}, ${150 + Math.random() * 100}, 255, 1)`,
      });
    }

    particlesRef.current = particles;
    nebulasRef.current = nebulas;
    shapesRef.current = shapes;
  }, []);

  // Draw a polygon shape
  const drawPolygon = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    sides: number,
    rotation: number
  ) => {
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + rotation;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
  };

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (particlesRef.current.length === 0) {
        initializeEffects(canvas.width, canvas.height);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    // Initialize effects if not done
    if (particlesRef.current.length === 0) {
      initializeEffects(canvas.width, canvas.height);
    }

    const animate = () => {
      const width = canvas.width;
      const height = canvas.height;
      timeRef.current += 16;
      const time = timeRef.current;

      // Clear with gradient background
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#0a0a12');
      gradient.addColorStop(0.3, '#0d0d18');
      gradient.addColorStop(0.6, '#0a0a14');
      gradient.addColorStop(1, '#08080f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Draw nebula blobs (background glow)
      for (const nebula of nebulasRef.current) {
        const pulse = Math.sin(time * nebula.pulseSpeed + nebula.phase) * 0.3 + 0.7;
        const grad = ctx.createRadialGradient(
          nebula.x,
          nebula.y,
          0,
          nebula.x,
          nebula.y,
          nebula.radius * pulse
        );
        grad.addColorStop(0, nebula.color);
        grad.addColorStop(0.5, nebula.color.replace(/[\d.]+\)$/, '0.05)'));
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(
          nebula.x - nebula.radius * pulse,
          nebula.y - nebula.radius * pulse,
          nebula.radius * 2 * pulse,
          nebula.radius * 2 * pulse
        );

        // Slowly drift nebulas
        nebula.x += Math.sin(time * 0.0001 + nebula.phase) * 0.1;
        nebula.y += Math.cos(time * 0.0001 + nebula.phase) * 0.05;

        // Wrap around
        if (nebula.x < -nebula.radius) nebula.x = width + nebula.radius;
        if (nebula.x > width + nebula.radius) nebula.x = -nebula.radius;
        if (nebula.y < -nebula.radius) nebula.y = height + nebula.radius;
        if (nebula.y > height + nebula.radius) nebula.y = -nebula.radius;
      }

      // Draw geometric shapes
      for (const shape of shapesRef.current) {
        shape.rotation += shape.rotationSpeed;

        ctx.save();
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = shape.opacity * (0.5 + 0.5 * Math.sin(time * 0.001));

        // Draw multiple nested polygons
        for (let i = 0; i < 3; i++) {
          const scale = 1 - i * 0.25;
          drawPolygon(ctx, shape.x, shape.y, shape.size * scale, shape.sides, shape.rotation + i * 0.2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Draw and update particles
      for (const particle of particlesRef.current) {
        // Update position
        particle.x += particle.vx;
        particle.y += particle.vy;

        // Wrap around screen
        if (particle.x < 0) particle.x = width;
        if (particle.x > width) particle.x = 0;
        if (particle.y < 0) particle.y = height;
        if (particle.y > height) particle.y = 0;

        // Pulsing effect
        const pulse = Math.sin(time * 0.003 + particle.pulsePhase) * 0.3 + 0.7;
        const currentOpacity = particle.opacity * pulse;
        const currentSize = particle.size * (0.8 + pulse * 0.4);

        // Draw particle with glow
        ctx.save();

        // Outer glow
        const glowGrad = ctx.createRadialGradient(
          particle.x, particle.y, 0,
          particle.x, particle.y, currentSize * 4
        );
        glowGrad.addColorStop(0, particle.color.replace(')', `, ${currentOpacity * 0.3})`).replace('rgb', 'rgba'));
        glowGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = glowGrad;
        ctx.fillRect(
          particle.x - currentSize * 4,
          particle.y - currentSize * 4,
          currentSize * 8,
          currentSize * 8
        );

        // Core
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, currentSize, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = currentOpacity;
        ctx.fill();

        ctx.restore();
      }

      // Draw connection lines between nearby particles (constellation effect)
      ctx.save();
      ctx.strokeStyle = 'rgba(100, 150, 255, 0.08)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particlesRef.current.length; i++) {
        const p1 = particlesRef.current[i];
        if (p1.layer !== 2) continue; // Only top layer particles

        for (let j = i + 1; j < particlesRef.current.length; j++) {
          const p2 = particlesRef.current[j];
          if (p2.layer !== 2) continue;

          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 120) {
            ctx.globalAlpha = (1 - dist / 120) * 0.3;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      // Central vortex effect
      const centerX = width / 2;
      const centerY = height / 2;
      const vortexRadius = Math.min(width, height) * 0.35;

      ctx.save();
      for (let ring = 0; ring < 4; ring++) {
        const ringRadius = vortexRadius * (0.4 + ring * 0.2);
        const rotation = time * 0.0002 * (ring % 2 === 0 ? 1 : -1);
        const opacity = 0.03 + (progress / 100) * 0.04;

        ctx.strokeStyle = `rgba(100, 150, 255, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, rotation, rotation + Math.PI * 1.5);
        ctx.stroke();
      }
      ctx.restore();

      // Energy beam effect based on progress
      if (progress > 0) {
        const beamProgress = progress / 100;
        const beamGrad = ctx.createLinearGradient(
          centerX - vortexRadius,
          centerY,
          centerX + vortexRadius * beamProgress,
          centerY
        );
        beamGrad.addColorStop(0, 'transparent');
        beamGrad.addColorStop(0.2, 'rgba(80, 140, 255, 0.1)');
        beamGrad.addColorStop(0.5, 'rgba(120, 100, 255, 0.15)');
        beamGrad.addColorStop(0.8, 'rgba(60, 200, 255, 0.1)');
        beamGrad.addColorStop(1, 'transparent');

        ctx.save();
        ctx.fillStyle = beamGrad;
        ctx.fillRect(0, centerY - 100, width, 200);
        ctx.restore();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, [initializeEffects, progress]);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Animated canvas background */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Content overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative z-10 flex flex-col items-center gap-8 p-8">
          {/* Logo/Title with enhanced glow */}
          <div className="text-center">
            <h1 className="text-6xl font-bold tracking-wider mb-2 relative">
              <span
                className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent"
                style={{
                  textShadow: '0 0 40px rgba(100, 150, 255, 0.5), 0 0 80px rgba(100, 100, 255, 0.3)',
                  filter: 'drop-shadow(0 0 20px rgba(100, 150, 255, 0.4))',
                }}
              >
                VOIDSTRIKE
              </span>
            </h1>
            <p
              className="text-void-400 text-sm tracking-widest uppercase"
              style={{ textShadow: '0 0 10px rgba(100, 150, 255, 0.3)' }}
            >
              Prepare for Battle
            </p>
          </div>

          {/* Loading bar container */}
          <div className="w-96 space-y-4">
            {/* Progress bar with enhanced styling */}
            <div className="relative h-3 bg-void-900/80 rounded-full overflow-hidden border border-void-600/50 backdrop-blur-sm">
              {/* Animated background shimmer */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(100, 150, 255, 0.1), transparent)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 2s infinite linear',
                }}
              />
              {/* Progress fill with gradient */}
              <div
                className="relative h-full rounded-full transition-all duration-200 ease-out"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4)',
                  boxShadow: '0 0 20px rgba(100, 150, 255, 0.6), inset 0 1px 0 rgba(255,255,255,0.2)',
                }}
              >
                {/* Glow effect at progress edge */}
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(100,200,255,0.4) 50%, transparent 70%)',
                    filter: 'blur(2px)',
                  }}
                />
              </div>
            </div>

            {/* Status text with enhanced styling */}
            <div className="flex items-center justify-between text-sm px-1">
              <span
                className="text-void-300 font-medium"
                style={{ textShadow: '0 0 10px rgba(100, 150, 255, 0.3)' }}
              >
                {status}{dots}
              </span>
              <span
                className="text-cyan-400 font-mono font-bold"
                style={{ textShadow: '0 0 15px rgba(6, 182, 212, 0.5)' }}
              >
                {Math.round(progress)}%
              </span>
            </div>
          </div>

          {/* Loading stages indicator */}
          <div className="flex gap-2 mt-2">
            {['Models', 'Renderer', 'Terrain', 'Engine', 'Audio'].map((stage, i) => {
              const stageProgress = [45, 55, 65, 85, 95];
              const isComplete = progress >= stageProgress[i];
              const isActive = progress >= (stageProgress[i - 1] || 0) && progress < stageProgress[i];
              return (
                <div
                  key={stage}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-300 ${
                    isComplete
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                      : isActive
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse'
                      : 'bg-void-800/50 text-void-500 border border-void-700/30'
                  }`}
                  style={isComplete || isActive ? { boxShadow: '0 0 10px rgba(100, 150, 255, 0.2)' } : {}}
                >
                  {stage}
                </div>
              );
            })}
          </div>

          {/* Tips section */}
          <div className="mt-6 text-center max-w-md">
            <p className="text-void-500 text-xs italic" style={{ textShadow: '0 0 5px rgba(0,0,0,0.5)' }}>
              &quot;Control is not about power. It&apos;s about precision.&quot;
            </p>
          </div>

          {/* Keyboard hints with improved styling */}
          <div className="grid grid-cols-3 gap-4 mt-4 text-xs text-void-400">
            {[
              { key: 'A', action: 'Attack Move' },
              { key: 'S', action: 'Stop' },
              { key: 'H', action: 'Hold Position' },
            ].map(({ key, action }) => (
              <div key={key} className="flex items-center gap-2">
                <kbd
                  className="px-2 py-1 bg-void-800/80 rounded border border-void-600/50 text-void-300 font-mono"
                  style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)' }}
                >
                  {key}
                </kbd>
                <span>{action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CSS for shimmer animation */}
      <style jsx>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }
      `}</style>
    </div>
  );
}
