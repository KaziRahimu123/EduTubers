import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling packages that contain native binaries
  serverExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg', 'pdf-parse'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
