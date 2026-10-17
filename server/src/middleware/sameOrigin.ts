import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import { appOriginCheck } from '../utils/appOrigin.js';

/** Not checked: they change nothing, and OPTIONS is CORS's own preflight. */
const UNCHECKED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuse a state-changing request that a browser says came from another origin.
 *
 * The session cookies are SameSite=Lax, which kept other *sites* from sending
 * them on a POST. That stops being enough once the app shares a registrable
 * domain with other apps: a page on any sibling subdomain is the same site, so
 * its forms and fetches carry the user's cookies, and CORS does not help — it
 * only stops the page reading the answer, after the request has done its work.
 * Origin names the page that actually sent the request, and browsers attach it
 * to every POST, PUT, PATCH and DELETE, same-origin ones included.
 *
 * Which origins are the app's own is `appOriginCheck`'s rule, shared with the
 * WebSocket: CLIENT_URL's exactly in production, plus loopback pages on any
 * port in development.
 *
 * A request without Origin passes: it comes from something that is not a
 * browser — curl, a script, another server — which has no victim's cookies to
 * spend. GET is left alone on purpose too: Google's OAuth callback arrives as a
 * cross-site GET by design.
 */
export function sameOriginWrites(clientUrl: string, nodeEnv: string) {
  const isAppOrigin = appOriginCheck(clientUrl, nodeEnv);

  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (UNCHECKED_METHODS.has(req.method) || origin === undefined || isAppOrigin(origin)) {
      next();
      return;
    }
    next(new AppError(403, 'FORBIDDEN', 'Cross-origin request refused'));
  };
}
