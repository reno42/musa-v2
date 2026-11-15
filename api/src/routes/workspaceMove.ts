/**
 * /api/workspace-move/* — mover cosas entre espacios desde la pantalla (sesión de usuario).
 *   GET  /items?ws=a,b&type=design,brand&q=   cosas de tus espacios con su etiqueta
 *   GET  /targets                     espacios donde puedes mover cosas
 *   POST /preview  { items, target, brandMode? }   resumen sin cambiar nada
 *   POST /apply    { items, target, brandMode? }   mueve (todo o nada)
 *   POST /:id/undo                    deshace un movimiento
 *   POST /delete   { items }           elimina (lo que tiene papelera va a la Papelera)
 *   GET  /history?workspaceId=        movimientos que entraron o salieron de un espacio
 * La lógica está en services/workspaceMove.ts (la misma que usa el MCP).
 */
import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../middleware/asyncRoute.js";
import * as M from "../services/workspaceMove.js";

export const workspaceMoveRoutes = Router();
const mode = (v: unknown) => (v === "unlink" ? "unlink" : "copy");
function wrap(fn: (req: Request) => Promise<any>) {
  return asyncRoute(async (req: Request, res: Response) => {
    try { res.json({ success: true, data: await fn(req) }); }
    catch (e: any) { res.status(e?.status || 400).json({ success: false, error: String(e?.message || e) }); }
  });
}
workspaceMoveRoutes.get("/items", wrap((req) => M.listItems(req.auth!, String(req.query.ws || "").split(",").filter(Boolean), { types: String(req.query.type || "").split(",").filter(Boolean), query: String(req.query.q || ""), limit: Number(req.query.limit) || 100 })));
workspaceMoveRoutes.get("/targets", wrap((req) => M.listTargets(req.auth!)));
workspaceMoveRoutes.post("/preview", wrap((req) => M.previewMove(req.auth!, req.body?.items, String(req.body?.target || ""), mode(req.body?.brandMode))));
workspaceMoveRoutes.post("/apply", wrap((req) => M.applyMove(req.auth!, req.body?.items, String(req.body?.target || ""), mode(req.body?.brandMode))));
workspaceMoveRoutes.post("/:id/undo", wrap((req) => M.undoMove(req.auth!, req.params.id)));
/* eliminar cualquier cosa de tus espacios (Papelera si la tiene) */
workspaceMoveRoutes.post("/delete", wrap((req) => M.deleteItems(req.auth!, req.body?.items)));
workspaceMoveRoutes.get("/history", wrap((req) => M.listMoves(req.auth!, String(req.query.workspaceId || ""), Number(req.query.limit) || 20)));
