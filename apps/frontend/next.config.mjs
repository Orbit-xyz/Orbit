import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      { source: "/docs", destination: "https://orbit-docs-eta.vercel.app", permanent: false },
      { source: "/docs/:path*", destination: "https://orbit-docs-eta.vercel.app/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
