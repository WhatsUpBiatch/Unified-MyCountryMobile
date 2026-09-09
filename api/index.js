/* The sandbox mock, running as a serverless function.
 *
 * The mock is normally a Vite dev-server middleware, and a static build has no
 * dev server — which is why the first hosted deploy hung on a spinner: every
 * /api call fell through the SPA rewrite and came back as index.html with a
 * 405. Mounting the same handlers here gives the hosted demo the same invented
 * data, with no real backend involved and nothing reaching production.
 *
 * One function, not a `[...path]` catch-all: the catch-all deployed as a
 * single-segment route, so /api/x answered and /api/user/info did not. The
 * rewrites in vercel.json hand the wanted path over in the query string
 * instead, which does not depend on how a filename is interpreted. */
import { apiHandler, captainHandler } from '../mock/index.mjs';

export default function handler(req, res) {
  const query = new URL(req.url, 'http://x').searchParams;
  /* Captain answers in its own envelope, so it keeps its own handler, and its
     path arrives with its own mount already stripped — the same shape the dev
     server's middleware gets. */
  const captain = query.get('captain');
  return captain
    ? captainHandler(req, res, `/${captain}`)
    : apiHandler(req, res, `/api/${query.get('path') || ''}`);
}
