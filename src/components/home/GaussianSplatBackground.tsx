'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

/**
 * GaussianSplatBackground - Displays rotating 3D Gaussian Splat scenes
 *
 * HOW TO ADD SPLAT FILES:
 * 1. Generate splat files using one of these methods:
 *    - Polycam (https://poly.cam/tools/gaussian-splatting) - video to splat
 *    - Luma AI (https://lumalabs.ai) - video capture to splat
 *    - Apple SHARP (https://github.com/apple/ml-sharp) - single image to splat
 *    - Scaniverse app - phone capture to splat
 *
 * 2. Place .splat, .ply, or .ksplat files in:
 *    /public/splats/
 *
 * 3. They will be automatically discovered and rotated through
 *
 * SUPPORTED FORMATS:
 * - .splat (standard format)
 * - .ply (INRIA format)
 * - .ksplat (compressed format)
 */

interface SplatScene {
  path: string;
  name: string;
}

interface GaussianSplatBackgroundProps {
  rotationInterval?: number; // milliseconds between scene changes (default: 90000 = 1.5 min)
  transitionDuration?: number; // milliseconds for transition (default: 3000)
  cameraDistance?: number; // distance from center (default: 5)
  autoRotate?: boolean; // slowly rotate camera (default: true)
  autoRotateSpeed?: number; // rotation speed (default: 0.1)
}

export default function GaussianSplatBackground({
  rotationInterval = 90000, // 1.5 minutes
  transitionDuration = 3000,
  cameraDistance = 5,
  autoRotate = true,
  autoRotateSpeed = 0.1,
}: GaussianSplatBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const viewerRef = useRef<unknown>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });

  const [scenes, setScenes] = useState<SplatScene[]>([]);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Discover available splat files
  useEffect(() => {
    const discoverScenes = async () => {
      try {
        const response = await fetch('/api/splats');
        if (response.ok) {
          const data = await response.json();
          if (data.scenes && data.scenes.length > 0) {
            setScenes(data.scenes);
            setLoadError(null);
          } else {
            setLoadError('No splat files found in /public/splats/');
          }
        } else {
          setLoadError('Failed to discover splat files');
        }
      } catch {
        setLoadError('Splat discovery API not available');
      }
      setIsLoading(false);
    };

    discoverScenes();
  }, []);

  // Initialize Three.js and load splat viewer
  const initViewer = useCallback(async () => {
    if (!containerRef.current || scenes.length === 0) return;

    // Dynamically import the gaussian splats library (client-side only)
    const GaussianSplats3D = await import('@mkkellogg/gaussian-splats-3d');

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050010);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    camera.position.set(0, 0, cameraDistance);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create splat viewer
    const viewer = new GaussianSplats3D.Viewer({
      scene,
      camera,
      renderer,
      selfDrivenMode: false,
      useBuiltInControls: false,
      dynamicScene: true,
      freeIntermediateSplatData: true,
      inMemoryCompressionLevel: 1,
      renderMode: GaussianSplats3D.RenderMode.Always,
      sceneRevealMode: GaussianSplats3D.SceneRevealMode.Gradual,
      logLevel: GaussianSplats3D.LogLevel.None,
    });

    viewerRef.current = viewer;

    // Load first scene
    try {
      await viewer.addSplatScene(scenes[0].path, {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      await viewer.start();
    } catch (err) {
      console.error('Failed to load splat scene:', err);
      setLoadError(`Failed to load: ${scenes[0].name}`);
    }

    // Mouse tracking for subtle camera movement
    const handleMouseMove = (event: MouseEvent) => {
      mouseRef.current = {
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight,
      };
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Resize handler
    const handleResize = () => {
      if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        viewer.resizeRenderer?.();
      }
    };
    window.addEventListener('resize', handleResize);

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.016;

      // Subtle camera movement
      if (camera) {
        const targetX = (mouseRef.current.x - 0.5) * 1.5;
        const targetY = (mouseRef.current.y - 0.5) * -0.8;

        camera.position.x += (targetX - camera.position.x) * 0.02;
        camera.position.y += (targetY - camera.position.y) * 0.02;

        // Auto rotate
        if (autoRotate) {
          const angle = timeRef.current * autoRotateSpeed;
          camera.position.x += Math.sin(angle) * 0.01;
          camera.position.z = cameraDistance + Math.cos(angle) * 0.5;
        }

        camera.lookAt(0, 0, 0);
      }

      // Update viewer
      viewer.update?.();
      viewer.render?.();
    };

    animate();

    // Cleanup
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationRef.current);
      viewer.dispose?.();
      renderer.dispose();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [scenes, cameraDistance, autoRotate, autoRotateSpeed]);

  // Initialize viewer when scenes are loaded
  useEffect(() => {
    if (scenes.length > 0 && !viewerRef.current) {
      initViewer();
    }
  }, [scenes, initViewer]);

  // Scene rotation with transitions
  useEffect(() => {
    if (scenes.length <= 1) return;

    const rotationTimer = setInterval(async () => {
      setIsTransitioning(true);

      // Fade out
      const fadeOutDuration = transitionDuration / 2;
      const fadeSteps = 30;
      const fadeOutStep = fadeOutDuration / fadeSteps;

      for (let i = fadeSteps; i >= 0; i--) {
        await new Promise(resolve => setTimeout(resolve, fadeOutStep));
        setOpacity(i / fadeSteps);
      }

      // Change scene
      const nextIndex = (currentSceneIndex + 1) % scenes.length;
      setCurrentSceneIndex(nextIndex);

      // Load new scene
      const viewer = viewerRef.current as {
        removeSplatScene?: (index: number) => Promise<void>;
        addSplatScene?: (path: string, options: object) => Promise<void>;
      } | null;

      if (viewer) {
        try {
          // Remove old scene
          await viewer.removeSplatScene?.(0);

          // Add new scene
          await viewer.addSplatScene?.(scenes[nextIndex].path, {
            splatAlphaRemovalThreshold: 5,
            showLoadingUI: false,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          });
        } catch (err) {
          console.error('Failed to transition to scene:', err);
        }
      }

      // Fade in
      const fadeInDuration = transitionDuration / 2;
      const fadeInStep = fadeInDuration / fadeSteps;

      for (let i = 0; i <= fadeSteps; i++) {
        await new Promise(resolve => setTimeout(resolve, fadeInStep));
        setOpacity(i / fadeSteps);
      }

      setIsTransitioning(false);
    }, rotationInterval);

    return () => clearInterval(rotationTimer);
  }, [scenes, currentSceneIndex, rotationInterval, transitionDuration]);

  // Show loading/error state or fallback
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-0 bg-gradient-to-b from-[#0a0015] via-[#050010] to-black flex items-center justify-center">
        <div className="text-void-400/50 text-sm animate-pulse">Loading scenes...</div>
      </div>
    );
  }

  if (loadError || scenes.length === 0) {
    // Return null to let the procedural background show through
    return null;
  }

  return (
    <>
      {/* Splat viewer container */}
      <div
        ref={containerRef}
        className="fixed inset-0 z-0"
        style={{
          opacity,
          transition: isTransitioning ? 'none' : 'opacity 0.3s ease',
          background: '#050010',
        }}
      />

      {/* Scene indicator */}
      {scenes.length > 1 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-20 flex gap-2">
          {scenes.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full transition-all duration-500 ${
                index === currentSceneIndex
                  ? 'bg-void-400 scale-125'
                  : 'bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>
      )}

      {/* Transition overlay for dissolve effect */}
      {isTransitioning && (
        <div
          className="fixed inset-0 z-10 pointer-events-none"
          style={{
            background: `radial-gradient(circle at center, transparent 0%, rgba(5, 0, 16, ${1 - opacity}) 100%)`,
          }}
        />
      )}
    </>
  );
}
