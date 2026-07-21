import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling packages that contain native binaries or
  // that use fs at module-load time.  They are left as bare require() calls
  // and resolved from node_modules at runtime by Node.js instead.
  serverExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg', 'pdf-parse'],
  experimental: {
    serverActions: {
      // bodySizeLimit applies to Server Actions only (not Route Handlers).
      bodySizeLimit: '110mb',
    },
    // proxyClientMaxBodySize controls the body limit that Next.js enforces
    // when it proxies the request body to Route Handlers.  Default is 10 MB —
    // must be raised to handle the 100 MB video uploads in /api/transcribe.
    proxyClientMaxBodySize: '110mb',
  },
};

export default nextConfig;
