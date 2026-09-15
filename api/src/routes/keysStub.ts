import { Router } from "express";

/** Local-only stand-in for the Netlify keys function (netlify/functions/
 *  keys.mjs). Production never reaches this: netlify.toml force-redirects
 *  /api/keys and /api/keys/* to the function before the Express catch-all,
 *  so this router only serves local dev, where the bridge otherwise
 *  answers 404 and spams the console. GET returns "no keys configured"
 *  (the honest local state); writes answer 501 with the reason. */
export const keysStubRoutes = Router();

keysStubRoutes.get("/", (_req, res) => {
  res.json({});
});

keysStubRoutes.all("/:provider", (_req, res) => {
  res.status(501).json({
    success: false,
    error: "BYOK vive en la función Netlify /api/keys — guarda claves en producción o corre netlify dev.",
  });
});
