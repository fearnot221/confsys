import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["development"] },
  server: {
    port: 25173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:23000" },
  },
});
