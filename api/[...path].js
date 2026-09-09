/* The sandbox mock, running as a serverless function.
 *
 * The mock is normally a Vite dev-server middleware, and a static build has no
 * dev server — which is why the first hosted deploy hung on a spinner: every
 * /api call fell through to the SPA rewrite and came back as index.html with a
 * 405. Mounting the same handlers here gives the hosted demo the same invented
 * data, with no real backend involved and nothing reaching production.
 *
 * The handlers are the ones mock/index.mjs already serves locally, so the
 * hosted sandbox and `npm run dev:mock` cannot drift apart. */
import { apiHandler, captainHandler } from '../mock/index.mjs';

export default function handler(req, res) {
  const url = String(req.url || '');
  /* Captain answers in its own envelope, so it keeps its own handler. It
     arrives here under /api/__captain because Vercel only routes /api to a
     function; vercel.json rewrites /captain-api onto that prefix, and the
     handler expects the path with its own mount stripped. */
  const captain = url.match(/^\/api\/__captain(\/.*)$/);
  return captain ? captainHandler(req, res, captain[1]) : apiHandler(req, res, url);
}
