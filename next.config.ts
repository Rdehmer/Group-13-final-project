import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["jspdf", "jspdf-autotable", "canvg", "core-js"],
};

export default nextConfig;
