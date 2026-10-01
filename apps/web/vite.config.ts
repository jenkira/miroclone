import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, forward API, sign-in, and collaboration traffic to the local services.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/collab": { target: "ws://localhost:1234", ws: true, rewrite: (p) => p.replace(/^\/collab\/[^/?]*/, "") },
    },
  },
});
