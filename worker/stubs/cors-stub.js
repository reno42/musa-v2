// CORS shim: firma express cors() pero aplica headers via res.setHeader
export default function cors(options) {
  return function corsMiddleware(req, res, next) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
    if (req.method === "OPTIONS") {
      res.status(204);
      return res.end();
    }
    next();
  };
}
