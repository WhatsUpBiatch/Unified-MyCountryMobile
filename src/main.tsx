import { createRoot } from 'react-dom/client';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import './index.css';
import 'react-phone-input-2/lib/style.css';
import App from './App.tsx';

polyfillCountryFlagEmojis();

/* Which portal this bundle is. The brand lock in index.css keys off it, so a
   build without a slug simply keeps the colours its organisation row supplies. */
document.documentElement.dataset.brand = import.meta.env.VITE_APP_SLUG || '';

const DYNAMIC_IMPORT_RELOAD_KEY = 'dynamic_import_reload_at';
const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'Loading chunk',
  'ChunkLoadError',
];

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return '';
};

const isDynamicImportLoadError = (error: unknown) => {
  const message = getErrorMessage(error);
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase()),
  );
};

const reloadForFreshAssets = () => {
  const lastReloadAt = Number(sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) || 0);
  const now = Date.now();

  if (now - lastReloadAt < 10000) return;

  sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, String(now));
  window.location.reload();
};

window.addEventListener('vite:preloadError', () => {
  // Keep the import rejected after scheduling recovery. Preventing this event
  // makes Vite resolve the lazy import with `undefined`, so React subsequently
  // crashes while trying to read the module's `default` export.
  reloadForFreshAssets();
});

window.addEventListener('unhandledrejection', (event) => {
  if (!isDynamicImportLoadError(event.reason)) return;

  event.preventDefault();
  reloadForFreshAssets();
});

window.addEventListener('error', (event) => {
  if (!isDynamicImportLoadError(event.error || event.message)) return;

  event.preventDefault();
  reloadForFreshAssets();
});

// Clear title until org data (fav_title) is loaded.
document.title = '';
createRoot(document.getElementById('root')!).render(<App />);

// import { createRoot } from 'react-dom/client';
// import './index.css';
// import 'react-phone-input-2/lib/style.css';
// import App from './App.tsx';

// createRoot(document.getElementById('root')!).render(<App />);
