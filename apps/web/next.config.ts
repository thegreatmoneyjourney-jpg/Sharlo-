import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lean, self-contained production build for the Docker image
  // (infra/ — M0-005) — bundles only the traced dependencies a request
  // actually needs into .next/standalone, instead of shipping node_modules.
  output: 'standalone',
};

export default nextConfig;
