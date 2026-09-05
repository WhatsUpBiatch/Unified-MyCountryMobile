/* Types for the mock API server, which is plain JavaScript on purpose — it is
   loaded by vite.config.ts before any TypeScript build step exists to compile
   it. Without this file `tsc -b` fails on the import with TS7016, which breaks
   `npm run build` rather than anything about the mock itself.

   The name matches index.mjs: a `.mjs` import resolves to `.d.mts`. */

import type { Plugin } from 'vite';

export declare const mockApiPlugin: () => Plugin;
