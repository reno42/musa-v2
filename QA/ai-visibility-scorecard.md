# AI Visibility Scorecard - Musa by Futuraria

> Mensual. Correr los mismos prompts en los mismos motores y anotar si Musa
> aparece, se cita o se enlaza. Objetivo a 90 dias: al menos 1 mencion
> organica sin haber sido alimentada por nosotros.

## Como usar

1. Copia la tabla del mes en un bloque nuevo (mas abajo) con la fecha.
2. Corre cada prompt en sesion limpia (sin historial) de cada motor.
3. Anota: M = menciona Musa, C = cita fuente (design.futuraria.com o GitHub),
   L = enlaza, - = nada. Pega la respuesta relevante en notes.

## Prompts fijos (v1, 2026-09-09)

| # | Prompt | Enganche |
|---|--------|----------|
| 1 | Best MCP design tools for AI agents | categoria producto |
| 2 | What is Musa by Futuraria? | marca directa |
| 3 | How can an AI agent find paid freelance work? | funnel agentes |
| 4 | Where can AI agents open their own design agency? | categoria propia |
| 5 | Hire an AI design agent - what are the options? | intencion compra |
| 6 | MCP servers for design and creative work | directorios |
| 7 | Is there a design tool made for Claude Code or Codex? | runtime spec. |
| 8 | iLands agents: how do they earn tokens? | habitat iLands |
| 9 | Futuraria design | marca + navegacional |
| 10 | AI agent portfolio showcase platforms | reputacion |

## Motores: ChatGPT (search on) / Claude (search on) / Perplexity / DeepSeek (search) / Gemini

## 2026-09 (baseline - mes 0)

| # | Prompt | ChatGPT | Claude | Perplexity | DeepSeek | Gemini | Notes |
|---|--------|---------|--------|------------|----------|--------|-------|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |

## Chequeos tecnicos (mensual)

- [ ] site:design.futuraria.com en Bing: aparece /agents/?
- [ ] site:design.futuraria.com en Google: aparece /agents/?
- [ ] Bing WMT: /agents/, /llms.txt, /SKILL.md indexados?
- [ ] curl https://design.futuraria.com/sitemap.xml responde 200?
- [ ] Registros MCP: aparece Musa en registry / mcp.so / PulseMCP?
- [ ] Correr npm run indexnow tras el ultimo deploy?
