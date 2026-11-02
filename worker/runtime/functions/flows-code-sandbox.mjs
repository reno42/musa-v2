// REQ-049 — sandbox del nodo code para runtimes sin code-gen (CF Workers).
// Wrapper PURO sobre quickjs-emscripten: no importa wasm ni paquetes — recibe
// el módulo QuickJS ya inicializado (en workerd desde el import .wasm de
// flows-code-sandbox-edge.mjs; en tests Node, del variant wasmfile). Así los
// QA ejercitan la MISMA lógica que corre en producción.
//
// El sandbox es total por construcción: un contexto QuickJS no trae
// fetch/require/process/timers — solo los intrínsecos del lenguaje (JSON,
// Math, RegExp...). Sin host functions: el código del usuario no puede tocar
// la red, el estado del worker ni el resto del engine. Memory limit +
// interrupt handler acotan CPU y RAM contra el presupuesto del nodo.

export const CODE_SANDBOX_MEMORY_LIMIT = 64 * 1024 * 1024;
export const CODE_SANDBOX_MAX_BUDGET_MS = 15_000;
// Blindaje de entrada: el engine ya trunca los outputs por paso
// (stepOutputChars 4KB, items cap 200); esto acota además el JSON total
// que entra al sandbox por global.
export const CODE_SANDBOX_GLOBAL_JSON_MAX = 1_000_000;

const clampBudget = (budgetMs) =>
  Math.max(250, Math.min(CODE_SANDBOX_MAX_BUDGET_MS, Number(budgetMs) || CODE_SANDBOX_MAX_BUDGET_MS));

/** Convierte un error QuickJS (dump: {name, message, stack}) en Error con
 *  mensaje estable — mismas frases que el fast-path de flows-core. */
function errorFromQuickJSDump(dumped, budget) {
  const name = String(dumped?.name ?? "Error");
  const message = String(dumped?.message ?? dumped ?? "error desconocido").slice(0, 300);
  if (/internally-controlled|interrupted|out of memory/i.test(`${name} ${message}`)) {
    return new Error(`El nodo code agotó el sandbox (CPU ${budget}ms o límite de memoria). Simplifica el código o reduce el volumen de datos.`);
  }
  if (name === "SyntaxError") return new Error(`Sintaxis inválida en el nodo code: ${message}`);
  return new Error(`El nodo code falló: ${name === "Error" ? message : `${name}: ${message}`}`);
}

/** Corre el cuerpo del nodo code con (items, item, input, steps) como globals
 *  y devuelve el VALOR crudo del return — la normalización a {items}|objeto|
 *  {value} la hace flows-core, igual que en el fast-path new Function. */
export async function runCodeInQuickJSModule(QuickJS, js, { items, item, input, steps, budgetMs } = {}) {
  const budget = clampBudget(budgetMs);
  const runtime = QuickJS.newRuntime();
  const deadline = Date.now() + budget;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  runtime.setMemoryLimit(CODE_SANDBOX_MEMORY_LIMIT);
  const vm = runtime.newContext();
  try {
    // Globals como literales JSON (JSON.parse/eval seguro: es JSON valido).
    for (const [name, value] of [["items", items], ["item", item], ["input", input], ["steps", steps]]) {
      let json;
      try { json = JSON.stringify(value ?? null) ?? "null"; } catch { json = "null"; }
      if (json.length > CODE_SANDBOX_GLOBAL_JSON_MAX) json = "null";
      // quickjs-emscripten 0.32 no tiene vm.setGlobal: el global se escribe con setProp(vm.global, …).
      // El handle se libera siempre (si quedara vivo, runtime.dispose aborta con gc_obj_list no vacía).
      const handle = vm.unwrapResult(vm.evalCode(`(${json})`));
      try { vm.setProp(vm.global, name, handle); } finally { handle.dispose(); }
    }
    // El IIFE async devuelve JSON.stringify(resultado): el stringify corre
    // DENTRO del sandbox (undefined resuelve undefined; ciclos → rejection
    // con TypeError) y afuera solo hay JSON.parse de un string.
    const evalResult = vm.evalCode(`(async () => JSON.stringify(await (async () => {\n${js}\n})()))()`);
    if (evalResult.error) {
      const dumped = vm.dump(evalResult.error);
      evalResult.error.dispose();
      throw errorFromQuickJSDump(dumped, budget);
    }
    const promiseHandle = evalResult.value;
    let state = vm.getPromiseState(promiseHandle);
    // Drenar microtasks hasta que la promesa del usuario se asiente. Sin host
    // functions no hay esperas externas: si se agotan los jobs y sigue
    // pending, el código quedó colgado en una promesa que nunca resuelve.
    while (state.type === "pending") {
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        const dumped = vm.dump(jobs.error);
        jobs.error.dispose();
        promiseHandle.dispose();
        throw errorFromQuickJSDump(dumped, budget);
      }
      const nextState = vm.getPromiseState(promiseHandle);
      if (nextState.type === "pending" && jobs.value === 0) {
        promiseHandle.dispose();
        throw new Error("El nodo code quedó esperando una promesa que nunca resuelve (¿new Promise sin resolver?). Devuelve un valor directo.");
      }
      state = nextState;
    }
    let dumped;
    if (state.type === "fulfilled") {
      dumped = vm.dump(state.value);
      state.value.dispose();
    } else {
      const reasonHandle = state.error;
      const reason = vm.dump(reasonHandle);
      reasonHandle.dispose();
      promiseHandle.dispose();
      throw errorFromQuickJSDump(reason, budget);
    }
    promiseHandle.dispose();
    if (typeof dumped !== "string") return dumped ?? null;
    try { return JSON.parse(dumped); } catch {
      throw new Error("El nodo code devolvió un valor que no serializa a JSON. Devuelve objetos/arrays/valores simples.");
    }
  } finally {
    // Vacía trabajos pendientes antes de liberar (promesas internas del async wrapper).
    try { for (let i = 0; i < 100 && runtime.hasPendingJob(); i++) { const r = runtime.executePendingJobs(); if (r.error) r.error.dispose(); } } catch { /* best-effort */ }
    vm.dispose();
    runtime.dispose();
  }
}
