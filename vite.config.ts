import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { mockApiPlugin } from "./mock/index.mjs";

const enableCrossOriginIsolation = process.env.VITE_CROSS_ORIGIN_ISOLATION === 'true';

// .env files live outside the repo (real secrets — Stripe, PayPal, HubSpot,
// WhatsApp token, Turnstile — shouldn't sit in a project directory that could
// end up in version control or get shared). Machines that have that directory
// keep using it. A checkout without it falls back to the repo root, where
// .env.development supplies the non-secret defaults a dev needs to boot —
// otherwise the app hangs on a spinner forever with no diagnosable error.
const EXTERNAL_ENV_DIR = '/etc/mycountrymobile-web';

/* SANDBOX COPY — a UI workbench. It is fully offline from the backend:
   mock/index.mjs answers every /api/* call with invented data, so no request
   can reach production and nothing here can change a real record.

   Env is read from this folder rather than /etc so VITE_API_BASE_URL stays
   blank; blank makes the app call /api/... on this dev server, which is where
   the mock is listening.

   autoLogin below seeds a fake token before the app boots, so the login screen
   never appears. The account is invented and exists only in this process. */
const SANDBOX_TOKEN = 'sandbox-fake-session-not-a-real-token';

const autoLogin = () => ({
  name: 'sandbox-auto-login',
  transformIndexHtml: (html: string) =>
    html.replace(
      '<head>',
      `<head><script>
  // The app treats a token in localStorage as "logged in" and hydrates the
  // user from GET /api/user/info, which the mock answers. Seeding it here
  // means no login round-trip and no real credentials anywhere.
  try {
    localStorage.setItem('ucaas-public-token', ${JSON.stringify(SANDBOX_TOKEN)});
    localStorage.removeItem('plan_pending');
  } catch (e) {}
</script>`,
    ),
});

export default defineConfig({
  envDir: __dirname,
  define: {
    global: 'globalThis',
    Lame: {},
    Presets: {},
    GainAnalysis: {},
    QuantizePVT: {},
    Quantize: {},
    Takehiro: {},
    Reservoir: {},
    MPEGMode: {},
    BitStream: {},
    assetsInclude: ['**/*.wasm'],
  },
  plugins: [mockApiPlugin(), autoLogin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    headers: enableCrossOriginIsolation
      ? {
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Cross-Origin-Opener-Policy': 'same-origin',
        }
      : undefined,
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.wasm')) {
            return 'assets/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
