const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEEPSEEK_BASE = "https://api.deepseek.com";
const GLM_BASE = "https://api.z.ai/api/paas/v4";
const RESPONSE_LIMIT = 512_000;
const MODEL_ID = /^[A-Za-z0-9._/-]{1,120}$/;
const GLM_MODELS = ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx", "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4.5-flash"];

export function validateAiConfig(config, nodeId = "IA") {
  if (!["gemini", "deepseek", "glm"].includes(config.provider)) throw new Error(`Proveedor IA inválido en ${nodeId}.`);
  const model = String(config.model ?? "").trim();
  if (model && (!MODEL_ID.test(model) || model.includes(".."))) throw new Error(`Modelo IA inválido en ${nodeId}.`);
  if (typeof config.prompt !== "string" || config.prompt.length > 20_000) throw new Error(`Prompt IA inválido en ${nodeId}.`);
  if (typeof config.systemPrompt !== "string" || config.systemPrompt.length > 5_000) throw new Error(`Instrucción IA inválida en ${nodeId}.`);
  const maxOutputTokens = Number(config.maxOutputTokens ?? 1024);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192) throw new Error(`Límite de tokens inválido en ${nodeId}.`);
  if (typeof config.credentialId !== "string" || (config.credentialId && !/^[A-Za-z0-9_-]{1,64}$/.test(config.credentialId))) throw new Error(`Credencial IA inválida en ${nodeId}.`);
}

function authHeaders(provider, credential) {
  if (!credential?.secret) throw new Error("Guarda y selecciona una API key para este nodo IA.");
  if (credential.provider && credential.provider !== provider) throw new Error(`La credencial seleccionada pertenece a ${credential.provider}, no a ${provider}.`);
  if (provider === "gemini") {
    if (credential.type !== "api_key" || credential.headerName?.toLowerCase() !== "x-goog-api-key") throw new Error("Gemini requiere una credencial API key con header x-goog-api-key.");
    return { "x-goog-api-key": credential.secret };
  }
  if (credential.type !== "bearer") throw new Error(`${provider === "glm" ? "GLM" : "DeepSeek"} requiere una credencial Bearer token.`);
  return { authorization: `Bearer ${credential.secret}` };
}

async function providerJson(fetchImpl, url, { method = "GET", headers, body, provider, timeoutMs = 40_000 }) {
  let response;
  try {
    response = await fetchImpl(url, { method, headers: { accept: "application/json", ...headers, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error(`${provider}: la API tardó más de ${timeoutMs / 1000} segundos.`);
    throw new Error(`${provider}: no se pudo conectar con la API oficial.`);
  }
  if (!response.ok) throw Object.assign(new Error(`${provider}: la API respondió HTTP ${response.status}. Comprueba API key, modelo, cuota y facturación.`), { httpStatus: response.status });
  const declared = Number(response.headers.get("content-length"));
  if (declared > RESPONSE_LIMIT) throw new Error(`${provider}: respuesta demasiado grande.`);
  const reader = response.body?.getReader();
  let size = 0; const chunks = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) { await reader.cancel(); throw new Error(`${provider}: respuesta demasiado grande.`); }
      chunks.push(value);
    }
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error(`${provider}: la API no devolvió JSON válido.`); }
}

export async function listAiModels(provider, credential, fetchImpl = fetch) {
  if (!["gemini", "deepseek", "glm"].includes(provider)) throw new Error("Proveedor IA inválido.");
  if (provider === "glm") return { models: GLM_MODELS, source: "documentation", note: "Modelos sugeridos según la documentación de Z.ai; también puedes escribir cualquier ID válido de tu cuenta." };
  const headers = authHeaders(provider, credential);
  if (provider === "deepseek") {
    const data = await providerJson(fetchImpl, `${DEEPSEEK_BASE}/models`, { headers, provider, timeoutMs: 10_000 });
    return { models: [...new Set((data.data ?? []).map((item) => item.id).filter((id) => typeof id === "string" && MODEL_ID.test(id)))].slice(0, 1_000), source: "live" };
  }
  const models = []; let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const url = new URL(GEMINI_BASE);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await providerJson(fetchImpl, url, { headers, provider, timeoutMs: 10_000 });
    for (const item of data.models ?? []) {
      const id = String(item.name ?? "").replace(/^models\//, "");
      if (MODEL_ID.test(id) && item.supportedGenerationMethods?.includes("generateContent")) models.push(id);
    }
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return { models: [...new Set(models)].slice(0, 2_000), source: "live" };
}

export async function runAiText(config, credential, fetchImpl = fetch, timeoutMs = 40_000) {
  const normalized = { ...config, prompt: typeof config.prompt === "string" ? config.prompt : JSON.stringify(config.prompt) };
  validateAiConfig(normalized);
  const provider = config.provider;
  const model = String(config.model ?? "").trim();
  if (!model) throw new Error("Selecciona un modelo IA antes de ejecutar.");
  const prompt = normalized.prompt.trim();
  if (!prompt) throw new Error("El prompt IA está vacío después de resolver las entradas.");
  const headers = authHeaders(provider, credential);
  const systemPrompt = String(config.systemPrompt ?? "").trim();
  const maxOutputTokens = Number(config.maxOutputTokens ?? 1024);
  let url; let body;
  if (provider === "gemini") {
    url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
    body = { contents: [{ role: "user", parts: [{ text: prompt }] }], ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}), generationConfig: { maxOutputTokens } };
  } else {
    url = `${provider === "deepseek" ? DEEPSEEK_BASE : GLM_BASE}/chat/completions`;
    body = { model, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: prompt }], max_tokens: maxOutputTokens, stream: false };
  }
  const data = await providerJson(fetchImpl, url, { method: "POST", headers, body, provider, timeoutMs });
  const text = provider === "gemini" ? data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") : data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error(`${provider}: el modelo no devolvió texto. Revisa filtros de seguridad, modelo y límite de tokens.`);
  return { text: text.slice(0, 100_000), model: String(data.modelVersion ?? data.model ?? model).slice(0, 120), provider, usage: provider === "gemini" ? { inputTokens: data.usageMetadata?.promptTokenCount ?? null, outputTokens: data.usageMetadata?.candidatesTokenCount ?? null } : { inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null } };
}
