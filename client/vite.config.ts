import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * In production the API is a different origin, so the first request pays a
 * fresh DNS + TCP + TLS handshake before a single byte is sent. Opening that
 * connection while the app bundle is still downloading takes it off the
 * critical path of the readiness probe and the session check.
 *
 * Injected only when VITE_API_URL is set; local development proxies /api
 * through the dev server on the same origin and needs no hint.
 */
function preconnectApiOrigin(apiUrl: string | undefined): Plugin {
  return {
    name: "typesync-preconnect-api-origin",
    transformIndexHtml() {
      if (!apiUrl) return [];

      let origin: string;
      try {
        origin = new URL(apiUrl).origin;
      } catch {
        return [];
      }

      return [
        {
          tag: "link",
          attrs: { rel: "dns-prefetch", href: origin },
          injectTo: "head-prepend" as const,
        },
        {
          tag: "link",
          attrs: { rel: "preconnect", href: origin, crossorigin: "" },
          injectTo: "head-prepend" as const,
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss(), preconnectApiOrigin(env.VITE_API_URL)],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
        "/socket.io": {
          target: "http://localhost:3000",
          ws: true,
        },
      },
    },
  };
});
