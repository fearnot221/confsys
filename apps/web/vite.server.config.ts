import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["development"] },
  ssr: { noExternal: true },
  build: {
    ssr: "src/entry-server.tsx",
    outDir: "dist/server",
    ssrEmitAssets: true,
    rollupOptions: { output: { assetFileNames: "public-site.[ext]" } },
  },
});
