import type { NextConfig } from "next";

const basePath = process.env.BASE_PATH || "";
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: basePath || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
