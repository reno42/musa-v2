import type { Request, Response, NextFunction } from "express";
import { getSupabase } from "../services/supabase.js";

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

  // Dev fallback: without Supabase, accept any key as user ID
  const sb = getSupabase();

  if (bearer && sb) {
    // JWT auth — accept raw and validate later
    req.auth = { userId: bearer };
  } else if (apiKey) {
    if (sb) {
      // Key sent — store for later validation in route handlers
      // The key will be validated against api_keys table when needed
      req.auth = { userId: apiKey };
    } else {
      // Local dev mode: key IS the user ID
      req.auth = { userId: apiKey };
    }
  } else {
    req.auth = { userId: "dev_user_default" };
  }
  next();
}
