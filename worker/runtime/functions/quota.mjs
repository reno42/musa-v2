// quota — REQ-028 Item 2: cuota freemium de la capa plataforma del Ghost.
//
// La cuota se cobra POR RUN (job aceptado por el gate de ghost_perform), NO
// por microacción LLM interna (req §2-Item 2.4): checkAndConsumeQuota se
// invoca 1× al aceptar, y los ~25 micro-pasos del bridge corren sin volver a
// pasar por acá. Un run abortado a la mitad NO se devuelve.
//
// ATOMICIDAD: el consumo es UNA llamada rpc (consume_llm_quota, migración
// llm_quota_v58.sql) que hace insert .. on conflict do update .. returning
// en una sola sentencia. 2 claims simultáneos del último run disponible ⇒
// exactamente 1 gana; el otro lee used > limit y es rechazado.
//
// FAIL-CLOSED (req §2-Item 2.5): los errores de DB NO se tragan acá — el
// caller (gate MCP / proxy) hace .catch y rechaza la capa plataforma con un
// mensaje técnico DISTINTO del de cuota agotada. Un error de base de datos
// nunca regala cuota infinita.

/** Límite default del plan gratis: env PLATFORM_FREE_GHOST_RUNS (parametrizable
 *  sin redeploy de código, req §2-Item 2.3). Default 30/mes. */
export function platformFreeRunLimit(env = process.env) {
  const n = Number.parseInt(String(env.PLATFORM_FREE_GHOST_RUNS || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/**
 * Consume `cost` (default 1) de cuota del mes UTC en curso para userId.
 * Devuelve:
 *   { ok: true,  used, limit, remaining }  — consumido y dentro del límite
 *   { ok: false, used, limit, remaining }  — LÍMITE AGOTADO (used ya > limit)
 * Lanza si la DB falla: el caller decide el fail-closed con su mensaje técnico.
 */
export async function checkAndConsumeQuota(sb, userId, { cost = 1, limit = 30 } = {}) {
  const { data, error } = await sb
    .rpc("consume_llm_quota", { p_user_id: userId, p_cost: cost })
    .single();
  if (error) throw new Error(error.message || "consume_llm_quota falló");
  const used = Number(data?.out_calls ?? 0);
  const remaining = Math.max(0, limit - used);
  return used > limit
    ? { ok: false, used: Math.min(used, limit), limit, remaining: 0 }
    : { ok: true, used, limit, remaining };
}

/**
 * Lectura SIN consumo (proxy /api/llm: verifica que quede cuota antes de
 * relayar con la key del server, pero NO cobra — el cobro fue 1× en el gate).
 * Devuelve null si la DB falla (el caller aplica fail-closed).
 * Ventana vigente = row con window_start >= 1ero del mes UTC; ventana vieja
 * cuenta como 0 (el gate la reinicia en el próximo consumo).
 */
export async function peekQuota(sb, userId, limit = 30) {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const { data, error } = await sb
      .from("llm_quota_usage")
      .select("window_start, platform_calls")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null;
    const inWindow = data?.window_start && new Date(data.window_start) >= monthStart;
    const used = inWindow ? Number(data.platform_calls || 0) : 0;
    const remaining = Math.max(0, limit - used);
    return { ok: remaining > 0, used: Math.min(used, limit), limit, remaining };
  } catch {
    return null;
  }
}
