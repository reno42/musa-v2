/* Entrada de public/musa/vendor/musa-anim.js: el MISMO modelo de animación de diseño que usa el MCP
   (shared/animationSchema.ts) para el editor de la maqueta, sin copias a mano. */
import * as A from "../shared/animationSchema.ts";
import * as T from "../shared/transformValue.ts";

const api = Object.assign({}, A, { parseTransform: T.parseTransform, composeTransform: T.composeTransform, isCanonicalTransform: T.isCanonicalTransform });
if (typeof window !== "undefined") window.MusaAnim = api;
if (typeof globalThis !== "undefined") globalThis.MusaAnim = api;
