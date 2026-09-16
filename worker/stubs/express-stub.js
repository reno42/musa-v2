// express shim: provee express(), express.json(), express.Router() desde el shim Hono-based
import { createExpressApp, Router } from "../express-shim.js";

function express() { return createExpressApp(); }
express.Router = Router;
express.json = function jsonParser(options) {
  return function jsonMiddleware(req, res, next) {
    // el body ya viene parseado por el shim (c.__body); next directo
    next();
  };
};
express.urlencoded = function() { return function(req, res, next) { next(); }; };
express.static = function() { return function(req, res, next) { next(); }; };

export default express;
export { Router };
