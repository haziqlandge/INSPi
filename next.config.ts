import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi use the dev server (`npm run dev:lan`).
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*'],
  serverExternalPackages: ['sharp'],
  devIndicators: false,
};

export default nextConfig;
