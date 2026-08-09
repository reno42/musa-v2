import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not catch a rejected promise from an `async` handler. The
 * rejection goes nowhere: no response is ever written and the request simply
 * stops.
 *
 * Locally that is a hung curl. On Netlify it is the whole failure mode — the
 * function adapter resolves its promise only when Express calls json/send/end,
 * so a rejection that writes nothing runs the invocation to the platform
 * timeout and hands the browser a bodyless 503 with nothing in the logs to
 * explain it. Every async middleware has to route its rejections into `next`.
 *
 * Express 5 does this on its own; drop this the day the API moves.
 */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    // The try matters as much as the catch: a handler that is not `async` can
    // throw before Promise.resolve ever sees it. Express happens to catch that
    // itself, but a wrapper whose guarantee has a hole in it is worse than no
    // wrapper, because every call site is written trusting it.
    try {
      Promise.resolve(fn(req, res, next)).catch(next);
    } catch (err) {
      next(err);
    }
  };
}
