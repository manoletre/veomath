import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      fs: './app/stubs/empty.js',
    },
  },
};

export default nextConfig;
