/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // Standalone output for smaller Vercel deployments
  output: 'standalone',

  // Reduce bundle size
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Exclude RainbowKit locale files (only keep English)
      config.resolve.alias = {
        ...config.resolve.alias,
      };

      // Ignore unused locale chunks from RainbowKit
      const { IgnorePlugin } = require('webpack');
      config.plugins.push(
        new IgnorePlugin({
          resourceRegExp: /^\.\/(?!en_US)[a-z]{2}_[A-Z]{2}$/,
          contextRegExp: /@rainbow-me\/rainbowkit\/dist/,
        })
      );
    }
    return config;
  },

  // Compress responses
  compress: true,

  // Optimize images
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'icons.llamao.fi' },
      { protocol: 'https', hostname: 'assets.coingecko.com' },
      { protocol: 'https', hostname: 'bdagscan.com' },
    ],
  },

  // Reduce serverless function size
  experimental: {
    optimizePackageImports: [
      '@rainbow-me/rainbowkit',
      'viem',
      'wagmi',
    ],
  },
};

module.exports = nextConfig;
