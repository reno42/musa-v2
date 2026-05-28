import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string };
    }
  }
}

export function auth(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] as string;
  const bearer = req.headers.authorization?.replace("Bearer ", "");

  if (apiKey) {
    req.auth = { userId: apiKey };
  } else if (bearer) {
    req.auth = { userId: bearer };
  } else {
    req.auth = { userId: "dev_user_default" };
  }
  next();
}
