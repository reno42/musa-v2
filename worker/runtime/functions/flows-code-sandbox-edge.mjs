// REQ-049 — loader del sandbox del nodo code para workerd (CF Workers).
// El WASM se importa como MÓDULO: la regla default de wrangler convierte
// `import ... from "*.wasm"` en un WebAssembly.Module pre-compilado, que el
// runtime SÍ permite (lo que prohíbe es compilar bytes — WebAssembly.compile —
// y el code-gen: eval / new Function). Por eso acá NUNCA se compilan bytes.
//
// Este módulo SOLO se carga vía dynamic import desde flows-core cuando el
// runtime rechaza el fast-path new Function — en Node (tests, netlify dev)
// jamás se evalúa. La lógica del sandbox vive en flows-code-sandbox.mjs.
import variantBase from "@jitl/quickjs-ng-wasmfile-release-sync";
import wasmModule from "@jitl/quickjs-ng-wasmfile-release-sync/wasm";
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import { runCodeInQuickJSModule } from "./flows-code-sandbox.mjs";

// Memoizado: una sola inicialización de wasm por isolate.
let modulePromise = null;
function getQuickJSModule() {
  modulePromise ??= newQuickJSWASMModuleFromVariant(newVariant(variantBase, { wasmModule }));
  return modulePromise;
}

/** Misma firma que el fast-path: (js, {items, item, input, steps, budgetMs})
 *  → valor crudo del return. Errores con mensaje estable del wrapper. */
export async function runCodeNodeSandboxed(js, vars) {
  return runCodeInQuickJSModule(await getQuickJSModule(), js, vars);
}
