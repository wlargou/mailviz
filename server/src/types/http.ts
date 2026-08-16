import type { Request as ExpressRequest } from 'express';
import type { ParamsFlatDictionary } from 'express-serve-static-core';

/**
 * Express request with flat route params.
 *
 * `@types/express` v5 defaults `req.params` to `ParamsDictionary`, whose index
 * signature is `string | string[]` to accommodate wildcard routes. Every route
 * in this app uses named params (`/:id`, `/:threadId`, ...), which are always a
 * single string at runtime — so the union just forces casts at ~56 call sites.
 *
 * `ParamsFlatDictionary` narrows the index signature to `string`. Use `Req` in
 * place of `Request` in controllers. If a wildcard route is ever added, that
 * handler should take the stock `Request` and narrow its params explicitly.
 *
 * The `user?` augmentation from `./express.d.ts` still applies — this is the
 * same `Request` interface, only with its params generic pinned.
 */
export type Req = ExpressRequest<ParamsFlatDictionary>;
