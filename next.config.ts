import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling packages that contain native binaries or
  // that use fs at module-load time.
  serverExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg', 'pdf-parse'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
