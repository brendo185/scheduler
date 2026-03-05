import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow importing shared code from the existing Vite app (../src, ../server, etc.)
    externalDir: true,
  },
};

export default nextConfig;
