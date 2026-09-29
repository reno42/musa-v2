export type MusaModule = "design" | "copywriting" | "motion" | "contacts" | "config";

const MODULE_PATTERNS: Record<MusaModule, RegExp> = {
  copywriting: /copy|redact|texto|grilla|calendario|contenido|publicaci[oó]n|post|caption|campaña/i,
  design: /diseñ|design|template|plantilla|carrusel|deck|slide|frame|imagen|logo|gráfico|grafico|visual/i,
  motion: /an[ií]m|animate|motion|v[ií]deo/i,
  contacts: /crm|contacto|cliente|prospecto|lead|venta|deal|seguimiento|follow.?up/i,
  config: /configur|conect|integraci[oó]n|api.?key|clave|mcp|workspace|automatiz|cron/i,
};

// Classification selects a cheap initial tool set; it never decides whether
// the user is authorized or whether a tool may execute.
export function chooseMusaModules(request: string): MusaModule[] {
  const matches = (Object.entries(MODULE_PATTERNS) as [MusaModule, RegExp][])
    .filter(([, pattern]) => pattern.test(request))
    .map(([module]) => module);
  // "Anima este diseño" names an existing design as input, not a request to
  // create another one. Keep both modules when a design action is explicit.
  if (matches.includes("motion") && matches.includes("design")
      && !/diseñ(?:a|ar|e|emos)|design\s+(?:a|the|new)|crear\s+(?:un\s+)?(?:diseño|plantilla|imagen)/i.test(request)) {
    return matches.filter(module => module !== "design");
  }
  return matches;
}

export function searchMusaTools<T extends { function: { name: string; description: string } }>(tools: T[], query: string): T[] {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(term => term.length > 2);
  if (terms.length === 0) return [];
  return tools.map(tool => {
    const haystack = `${tool.function.name} ${tool.function.description}`.toLowerCase();
    return { tool, score: terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) };
  }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 12).map(entry => entry.tool);
}
