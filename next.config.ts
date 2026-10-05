import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: '/agentic', destination: '/', permanent: false }];
  },
  turbopack: {
    resolveAlias: {
      fs: './app/stubs/empty.js',
    },
  },
};

export default nextConfig;
