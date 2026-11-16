import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (node server.js, no node_modules needed).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Don't let `next dev` generate AGENTS.md.
  agentRules: false,
  turbopack: {
    // Pin the project root, or Next.js picks up a stray lockfile in a parent folder and warns.
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
