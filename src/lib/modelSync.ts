// modelSync — sincroniza el catálogo REAL de modelos de cada proveedor vía
// su endpoint /models (mismo host que el chat/completions del provider, así
// que el CORS ya está resuelto por diseño BYOK: la llamada sale directo del
// navegador con la key desencriptada de la cuenta, nunca localStorage).
//
// Los curated lists de aiProviders.ts siguen siendo la base del dropdown;
// lo que el proveedor reporta se UNIONA. Así un modelo nuevo que publique
// OpenAI/Anthropic/Zhipu/… aparece sin deploy ni edición de catálogo.
//
// Sin key configurada no se pregunta nada (los endpoints exigen key; el
// único público es OpenRouter, y ahí igual respetamos el mismo flujo).

import { CHAT_PROVIDERS } from "./aiProviders";

/**
 * GET /models del proveedor → ids de modelos. Lanza en fallo HTTP: el
 * llamador decide si muestra aviso o conserva los curated.
 * Anthropic usa /v1/models con x-api-key (no Bearer) — mismo patrón que el
 * chat de ChatFAB.
 */
export async function fetchProviderModels(providerId: string, apiKey: string): Promise<string[]> {
  const prov = CHAT_PROVIDERS.find(p => p.id === providerId);
  if (!prov || !apiKey) return [];
  const isAnthropic = providerId === "anthropic";
  const modelsUrl = prov.endpoint.replace("/chat/completions", "/models");
  const resp = await fetch(modelsUrl, {
    headers: isAnthropic
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
      : { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`models ${resp.status}`);
  const data = await resp.json();
  const ids: string[] = (Array.isArray(data?.data) ? data.data : [])
    .map((m: any) => String(m?.id || m?.name || "").trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}
