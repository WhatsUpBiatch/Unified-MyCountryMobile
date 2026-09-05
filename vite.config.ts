import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

const enableCrossOriginIsolation = process.env.VITE_CROSS_ORIGIN_ISOLATION === 'true';

// .env files live outside the repo (real secrets — Stripe, PayPal, HubSpot,
// WhatsApp token, Turnstile — shouldn't sit in a project directory that could
// end up in version control or get shared). Machines that have that directory
// keep using it. A checkout without it falls back to the repo root, where
// .env.development supplies the non-secret defaults a dev needs to boot —
// otherwise the app hangs on a spinner forever with no diagnosable error.
const EXTERNAL_ENV_DIR = '/etc/mycountrymobile-web';

export default defineConfig({
  envDir: fs.existsSync(EXTERNAL_ENV_DIR) ? EXTERNAL_ENV_DIR : __dirname,
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
  plugins: [react(), tailwindcss()],
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
