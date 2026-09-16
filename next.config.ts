import type { NextConfig } from "next";

const basePath = process.env.BASE_PATH || "";
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
