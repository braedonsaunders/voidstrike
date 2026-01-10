'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

/**
 * DepthParallaxLayer - Creates a 3D parallax effect from a 2D image using a depth map
 *
 * HOW TO PREPARE IMAGES:
 * 1. Generate a stunning scene image (MidJourney, Blender render, etc.)
 * 2. Generate a depth map using:
 *    - Apple's Sharp/Vision framework
 *    - Depth-anything AI model
 *    - MiDaS depth estimation
 *    - Blender's Z-depth pass
 * 3. Name files: scene.jpg and scene_depth.jpg (grayscale depth map)
 * 4. Place in /public/images/homescreen/
 *
 * DEPTH MAP FORMAT:
 * - Grayscale image, same dimensions as source
 * - White = near (moves more with camera)
 * - Black = far (moves less with camera)
 */

// Depth displacement shader
const DepthParallaxShader = {
  uniforms: {
    uTexture: { value: null },
    uDepthMap: { value: null },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uParallaxStrength: { value: 0.05 }, // How much the image shifts
    uDepthScale: { value: 1.0 }, // Depth intensity multiplier
    uTime: { value: 0 },
    uZoom: { value: 1.0 }, // Slight zoom for edge coverage
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D uTexture;
    uniform sampler2D uDepthMap;
    uniform vec2 uMouse;
    uniform float uParallaxStrength;
    uniform float uDepthScale;
    uniform float uTime;
    uniform float uZoom;

    varying vec2 vUv;

    void main() {
      // Center and scale UV for zoom
      vec2 centeredUv = (vUv - 0.5) / uZoom + 0.5;

      // Calculate mouse offset from center
      vec2 mouseOffset = (uMouse - 0.5) * 2.0;

      // Sample depth at this position
      float depth = texture2D(uDepthMap, centeredUv).r;

      // Apply depth scaling (invert so white = near = more movement)
      depth = (1.0 - depth) * uDepthScale;

      // Calculate parallax displacement
      // Near objects (high depth value) move more opposite to mouse
      vec2 parallaxOffset = mouseOffset * uParallaxStrength * depth;

      // Add subtle floating motion based on depth
      float floatAmount = sin(uTime * 0.3 + depth * 3.14159) * 0.002 * depth;
      parallaxOffset.y += floatAmount;

      // Sample the texture with parallax offset
      vec2 finalUv = centeredUv + parallaxOffset;

      // Clamp to prevent edge artifacts
      finalUv = clamp(finalUv, 0.01, 0.99);

      vec4 color = texture2D(uTexture, finalUv);

      // Optional: slight vignette to blend edges
      float vignette = 1.0 - length((vUv - 0.5) * 1.5) * 0.3;
      color.rgb *= vignette;

      gl_FragColor = color;
    }
  `,
};

interface DepthParallaxLayerProps {
  imagePath: string;
  depthMapPath: string;
  parallaxStrength?: number;
  depthScale?: number;
  zoom?: number;
  opacity?: number;
  className?: string;
}

export default function DepthParallaxLayer({
  imagePath,
  depthMapPath,
  parallaxStrength = 0.05,
  depthScale = 1.0,
  zoom = 1.05, // Slight zoom to cover edges during parallax
  opacity = 1,
  className = '',
}: DepthParallaxLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const animationRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const targetMouseRef = useRef({ x: 0.5, y: 0.5 });
  const timeRef = useRef(0);

  const setupScene = useCallback(async () => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Orthographic camera for 2D rendering
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Load textures
    const textureLoader = new THREE.TextureLoader();

    try {
      const [texture, depthMap] = await Promise.all([
        new Promise<THREE.Texture>((resolve, reject) => {
          textureLoader.load(imagePath, resolve, undefined, reject);
        }),
        new Promise<THREE.Texture>((resolve, reject) => {
          textureLoader.load(depthMapPath, resolve, undefined, reject);
        }),
      ]);

      // Configure textures
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      depthMap.minFilter = THREE.LinearFilter;
      depthMap.magFilter = THREE.LinearFilter;

      // Create shader material
      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...DepthParallaxShader.uniforms,
          uTexture: { value: texture },
          uDepthMap: { value: depthMap },
          uParallaxStrength: { value: parallaxStrength },
          uDepthScale: { value: depthScale },
          uZoom: { value: zoom },
        },
        vertexShader: DepthParallaxShader.vertexShader,
        fragmentShader: DepthParallaxShader.fragmentShader,
        transparent: true,
      });
      materialRef.current = material;

      // Create fullscreen quad
      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
    } catch (error) {
      console.warn('DepthParallaxLayer: Could not load images, layer disabled', error);
    }
  }, [imagePath, depthMapPath, parallaxStrength, depthScale, zoom]);

  useEffect(() => {
    setupScene();

    // Mouse tracking with smoothing
    const handleMouseMove = (event: MouseEvent) => {
      targetMouseRef.current = {
        x: event.clientX / window.innerWidth,
        y: 1 - event.clientY / window.innerHeight, // Invert Y for natural feel
      };
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Resize handler
    const handleResize = () => {
      if (rendererRef.current && cameraRef.current) {
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    // Animation loop
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.016;

      // Smooth mouse interpolation
      mouseRef.current.x += (targetMouseRef.current.x - mouseRef.current.x) * 0.05;
      mouseRef.current.y += (targetMouseRef.current.y - mouseRef.current.y) * 0.05;

      // Update shader uniforms
      if (materialRef.current) {
        materialRef.current.uniforms.uMouse.value.set(
          mouseRef.current.x,
          mouseRef.current.y
        );
        materialRef.current.uniforms.uTime.value = timeRef.current;
      }

      // Render
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Cleanup
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationRef.current);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [setupScene]);

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 ${className}`}
      style={{ opacity, zIndex: -1 }}
    />
  );
}
