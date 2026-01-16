/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Next.js 16+ uses Turbopack by default
  // Empty config acknowledges we're okay with Turbopack (it handles workers natively)
  turbopack: {},

  // Exclude public assets from serverless function bundling
  // Without this, Vercel bundles all public/ files into API routes that use fs
  outputFileTracingExcludes: {
    '/api/*': ['./public/**/*'],
  },

  // Security headers required for SharedArrayBuffer (WASM threading)
  // Safari requires these headers for SharedArrayBuffer to be available
  // Without them, WASM modules like recast-navigation will fail to initialize
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    // Add support for web workers
    config.module.rules.push({
      test: /\.worker\.(js|ts)$/,
      use: { loader: 'worker-loader' },
    });

    // Fix for three.js
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
