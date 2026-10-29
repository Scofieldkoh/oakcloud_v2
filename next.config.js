/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow cross-origin requests from custom domain in development
  allowedDevOrigins: ['oakcloud.app', '*.oakcloud.app'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  webpack: (config) => {
    // Persistent Webpack packs fail to snapshot resolve dependencies in this Windows/OneDrive workspace.
    config.cache = false;
    return config;
  },
};

module.exports = nextConfig;
