import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // web-tree-sitter loads its own WASM runtime and grammar files from node_modules at runtime (Phase 2H structure
  // analysis), so it must stay a plain Node dependency instead of being bundled.
  serverExternalPackages: ["web-tree-sitter"],
};

export default nextConfig;
