import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["development"] },
  server: {
    port: Number(process.env.WEB_PORT ?? 25173),
    strictPort: true,
    proxy: {
      "^/(?!auth/(?:login|register|waiting|verify|forgot|reset|account|invitation)(?:[?]|$)|access/accounts(?:[?]|$)|admin/(?:site|invitations|registration|submissions|finance|receipts)(?:[?]|$)|account/files(?:[?]|$)|(?:registration|finance|receipts)(?:[?]|$)|submissions(?:[?]|$)|system/status(?:[?]|$)|src/|@|node_modules/|assets/).*":
        {
          target: `http://127.0.0.1:${process.env.API_PORT ?? 23000}`,
          changeOrigin: false,
        },
    },
  },
});
