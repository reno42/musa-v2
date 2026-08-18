// MCP flow test: Leader → Implementer
// Usage: node test_mcp_flow.mjs
const API_KEY = "fdr_ws_m1_9HW2dt2nD8Tl9BCHs3gsJHb2akuum";
const ENDPOINT = "https://design.futuraria.com/mcp";

async function mcp(method, params = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: method, arguments: params }, id: 1 });
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body,
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  // Unwrap MCP content wrapper
  const content = json.result?.content;
  if (content?.[0]?.type === "text") {
    try { return JSON.parse(content[0].text); }
    catch { return content[0].text; }
  }
  return json.result;
}

function log(label, data) {
  console.log(`\n━━━ ${label} ━━━`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

const PHASE = process.argv[2] || "2"; // "1" to create card, "2" to delegate, "all" for both
const CARD_ID = process.argv[3] || "card_msjjm21a_x2uy83"; // from previous Phase 1 run
const WS_ID = "ws_user_8e9f031817184e0ab205";
const BRAND_ID = "brand_d414751c-366"; // Futuraria_Infographic

async function main() {
  try {
    // 1. Healthcheck
    const health = await mcp("harness_healthcheck");
    log("1. HEALTHCHECK", health);
    if (!health.ok) {
      console.error("❌ Healthcheck FAILED:", health.checks);
      return;
    }

    // 2. Get context
    const ctx = await mcp("harness_get_context", { agentType: "leader" });
    log("2. CONTEXT", { role: ctx?.agentDefinition?.name, taskId: ctx?.task?.id });

    let cardId = CARD_ID;

    if (PHASE === "1" || PHASE === "all") {
      // 3. List brand guidelines
      const brands = await mcp("list_brand_guidelines", { workspaceId: WS_ID });
      const infographic = Array.isArray(brands?.brands) ? brands.brands.find(b => b.name === "Futuraria_Infographic") : null;
      log("3. BRAND FOUND", infographic ? { id: infographic.id, name: infographic.name } : "NOT FOUND");

      // 4. Create the design card
      const card = await mcp("studio_create_card", {
        workspaceId: WS_ID,
        title: "Cómo funciona un arnés para IAs - 4 Slides",
        description: "Utiliza el estilo Futuraria_infographic y diseña 4 slides de 1920x1080, hablando sobre cómo funciona un arnés para IAs",
      });
      log("4. CARD CREATED", card);

      // 5. Move card to design
      const moveResult = await mcp("studio_move_card", {
        cardId: card.id || card.cardId || card.card?.id,
        toStatus: "design",
      });
      log("5. CARD MOVED TO DESIGN", moveResult);
      cardId = card.id || card.cardId || card.card?.id;

      console.log(`\n✅ Phase 1 complete — Card ID: ${cardId}`);
    }

    // ── PHASE 2: Get brand info, delegate to implementer ──
    const brand = await mcp("get_brand_guideline", { brandId: BRAND_ID, workspaceId: WS_ID, includeArtifacts: true });
    log("6. BRAND DETAIL", { name: brand?.name, hasTokens: !!brand?.tokens, hasDesignMd: !!brand?.designMd, hasSharedCss: !!brand?.sharedCss });

    // 7. Start a session
    const session = await mcp("harness_start_session", {
      taskId: cardId,
      role: "implementer",
      plan: "Diseñar 4 slides 1920x1080 usando el estilo Futuraria_Infographic sobre cómo funciona un arnés para IAs",
    });
    log("7. SESSION STARTED", { sessionId: session?.sessionId, contextSummary: session?.contextSummary?.slice(0, 200) });

    // 8. Delegate to implementer
    const delegation = await mcp("harness_delegate_task", {
      taskId: cardId,
      brandId: BRAND_ID,
      expectedFrameCount: 4,
      requiredWidth: 1920,
      requiredHeight: 1080,
      requiredTexts: [
        "Cómo funciona un Arnés para IAs",
        "El arnés es la capa de infraestructura que controla, monitorea y optimiza agentes de IA en producción",
        "Componentes clave: Orquestación, Memoria, Verificación, y Gobernanza",
        "Resultado: IAs más seguras, trazables y eficientes"
      ],
      requiredTextsByFrame: [
        ["Cómo funciona un Arnés para IAs", "La infraestructura inteligente para agentes"],
        ["El arnés controla, monitorea y optimiza agentes de IA en producción", "Capa de seguridad y trazabilidad"],
        ["Componentes clave", "Orquestación · Memoria · Verificación · Gobernanza"],
        ["Resultado: IAs más seguras, trazables y eficientes", "Producción confiable 24/7"]
      ],
      requiredStyle: "Futuraria_Infographic",
    });
    log("8. DELEGATION RESULT", delegation);

    // 9. Check harness entries
    const entries = await mcp("harness_get_entries", { sessionId: session?.sessionId });
    log("9. HARNESS ENTRIES", Array.isArray(entries) ? { count: entries.length, last: entries[entries.length - 1] } : entries);

    console.log("\n✅ Phase 2 complete — implementer delegated");
  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
}

main();
