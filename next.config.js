/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow cross-origin requests from custom domain in development
  allowedDevOrigins: ['oakcloud.app', '*.oakcloud.app'],
  // Signed e-signing PDFs read the bundled Unicode fonts from disk at runtime; a standalone build only
  // copies files that tracing can see, so list them here. (`next start` and the Docker image run from
  // the full checkout, where the folder is already present.)
  outputFileTracingIncludes: {
    // PDF generation runs from API routes and from the in-process scheduler (instrumentation), so all routes.
    '/**/*': ['./assets/fonts/esigning/**/*'],
  },
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
