import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { mockApiPlugin } from "./mock/index.mjs";

const enableCrossOriginIsolation = process.env.VITE_CROSS_ORIGIN_ISOLATION === 'true';

/* Mock mode: `npm run dev:mock`, which is `vite --mode mock`.
 *
 * It answers every /api/* call from mock/ with invented data and seeds a fake
 * session, so the app opens straight onto the dashboard as an administrator
 * with no login and no backend. That is the only way to be "already logged in"
 * against this product — a real token is checked by the API, so one cannot be
 * fabricated; the API has to be the thing that is fake.
 *
 * Three things keep it out of anything real:
 *   it is off unless the mode is asked for by name;
 *   both pieces are dev-server hooks, and a production build runs neither;
 *   in this mode nothing reaches the real API at all, because the mock answers
 *   before the proxy is consulted.
 *
 * `npm run dev` is untouched: real API, real login. */
const MOCK_SESSION_TOKEN = 'mock-mode-fake-session-not-a-real-token';

const autoLogin = () => ({
  name: 'mcm-mock-auto-login',
  transformIndexHtml: (html: string) =>
    html.replace(
      '<head>',
      `<head><script>
  // The app treats a token in localStorage as "signed in" and then hydrates the
  // user from GET /api/user/info, which the mock answers. Seeding it here means
  // no login round-trip and no real credentials on anyone's machine.
  try {
    localStorage.setItem('ucaas-public-token', ${JSON.stringify(MOCK_SESSION_TOKEN)});
    localStorage.removeItem('plan_pending');
  } catch (e) {}
</script>`,
    ),
});

// .env files live outside the repo (real secrets — Stripe, PayPal, HubSpot,
// WhatsApp token, Turnstile — shouldn't sit in a project directory that could
// end up in version control or get shared). Machines that have that directory
// keep using it. A checkout without it falls back to the repo root, where
// .env.development supplies the non-secret defaults a dev needs to boot —
// otherwise the app hangs on a spinner forever with no diagnosable error.
const EXTERNAL_ENV_DIR = '/etc/mycountrymobile-web';

/* Typed, so `assetFileNames` still infers its parameter. Inline inside
   defineConfig it was contextually typed; a bare object literal is not. */
const baseConfig: UserConfig = {
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
    /* Development only — Vite does not proxy a built app.

       The API's CORS allowlist holds two origins and no more:
       http://localhost:5173 and http://localhost:3000. Everything else is
       refused, including http://127.0.0.1:5173 — same machine, different
       origin — and http://localhost:5174, which is where Vite quietly moves
       when 5173 is already taken. A developer in either case gets the
       "Server maintenance" screen, because a blocked preflight reaches the app
       as a failed request and nothing distinguishes that from a dead API.

       Routing through this server sidesteps it: the browser calls its own
       origin, and the hop to the API is server-to-server, where CORS does not
       apply. Any port, and either hostname, then works. It relies on
       VITE_API_BASE_URL being empty in development so requests stay relative —
       see .env.development. */
    proxy: {
      '/api': {
        target: 'https://api2.mycountrymobile.com',
        changeOrigin: true,
        secure: true,
      },
    },
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
};

/* The mock is added only when the mode is asked for by name, so `npm run dev`
   cannot quietly serve invented data. Both pieces are dev-server hooks, so a
   production build ignores them even if the mode were somehow set. */
export default defineConfig(({ mode }) => ({
  ...baseConfig,
  plugins: mode === 'mock' ? [mockApiPlugin(), autoLogin(), react(), tailwindcss()] : [react(), tailwindcss()],
}));
