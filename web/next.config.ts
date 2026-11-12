import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain files for GitHub Pages, which serves the site under /RLK.
  output: "export",
  basePath: process.env.PAGES_BASE_PATH ?? "",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
