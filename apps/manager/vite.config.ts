import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/manager/",
  plugins: [react()],
  server: {
    port: 4174,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/audio": "http://127.0.0.1:3001",
    },
  },
});
