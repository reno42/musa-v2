# 📈 Capacidad del stack freemium — Cuántos usuarios aguanta Futuraria Design

> **Fecha:** agosto 2026 (post v27 — smart tick, cuota mensual y poll visibility-aware).
> **Fuente:** mediciones reales del ciclo agosto 2026 (email de Netlify al 50%, tabla de
> invocaciones 24h, CSV de bandwidth `reno42` 2026-08-01→09-01) + límites publicados del
> plan Free. Es un **estimado de planificación**, no una garantía: revisar contra la pestaña
> Usage del equipo cada fin de mes.

---

## 1. El pool de recursos (plan Free, agosto 2026)

| Recurso | Límite free | Consumo medido ago-2026 | Estado |
|---|---|---|---|
| Function invocations (Netlify, toda la cuenta) | **125,000/mes** | ~62.5K al día 22 (email 50%) · últimas 24h ~1.1K | ⚠️ cuello de botella #1 |
| Bandwidth (Netlify, toda la cuenta) | **100 GB/mes** | 16.0 GB (13.95 GB = design.futuraria.com + ~2.3 GB previews) | 🟡 ok, vigilar previews |
| Compute credits (background functions) | **300 créditos/mes** (10 c/GB-hora) | mayormente no-op ticks (~2s); corridas reales 2–5 min | 🟡 riesgo en maratones de agente |
| Supabase DB | **500 MB** | diseños JSONB ~50–200 KB c/u | 🟢 ≈ 5,000 diseños de holgura |
| Scheduled functions | 2 funciones × 24/día | harness-cron + musa-batch-tick = 1,488 inv/mes | 🟢 1.2% del pool |

**Nota LLM:** el pipeline Musa usa BYOK (la key del usuario) → los tokens NO consumen
cuota de Netlify ni de Supabase. El costo por diseño generado lo paga cada cuenta con su
propia key de DeepSeek/OpenAI/Anthropic.

---

## 2. Perfiles de consumo por usuario (post-v27)

| Perfil | Fórmula | Llamadas /mcp/mes |
|---|---|---|
| 👤 Humano ligero (solo editor, sin Kanban) | lecturas del dashboard +snapshot puntual | ~100–300 |
| 🎴 Humano con Kanban abierto 2h/día (visible, 30s) | 120/h × 2h × 22d | ~5,300 |
| 🌑 Pestaña estacionada (background) | 0 — el poll v27 no corre si la pestaña no se ve | **0** (antes: ~31,700 ❌) |
| 🤖 Agente MCP trabajando | 50–300 tools por sesión × 10 sesiones | ~2,000–3,000 |
| ♻️ Musa batch con trabajo | corrida real 2–5 min ≈ 1–2 créditos; ticks en vacío ≈ 0 | ~20–50 inv + créditos |

La columna clave: **el fix de visibility + intervalo 30s mató al mayor quemador**
(la pestaña estacionada pasaba de ~31,700 a 0 llamadas/mes).

---

## 3. Escenarios de capacidad

Mezcla base por cada 10 usuarios: 6 ligeros + 3 con Kanban + 1 agente ≈ **18,400 llamadas/mes**.

| Escenario | Inv/mes | % del pool (125K) | Veredicto |
|---|---|---|---|
| 10 usuarios | ~18K | 15% | 🟢 holgado |
| 25 usuarios | ~46K | 37% | 🟢 cómodo |
| 50 usuarios | ~92K | 74% | 🟡 al límite — llega el email del 75% |
| 75 usuarios | ~138K | 110% | 🔴 se suspende antes de fin de mes |
| 100 usuarios | ~184K | 147% | 🔴 imposible sin plan pago o cuotas duras |

**Con la cuota v27 por defecto (5,000 llamadas/workspace/mes):** garantizado
125K ÷ 5K = **25 workspaces aunque todos llenen su cuota**. Con mezcla realista
(no todos usan el Kanban 2h/día) el mismo pool sirve cómodamente a **40–60
workspaces**. Ese es el número de planificación para el free tier.

### Bandwidth (segundo cuello)

- Carga completa del app: **~23.3 MB** (medido en cada deploy preview).
- Usuario activo: ~5 cargas/día × 22d ≈ 2.5 GB brutos; con caché de assets ~**1 GB/mes real**.
- 100 GB − 16 GB ya medidos ⇒ **~80 usuarios activos** como techo de bandwidth,
  y solo si se eliminan los deploy previews (ver palancas).

### Compute credits (tercer cuello, el más traicionero)

- Tick horario en vacío (v2.4): ~2s × 24/día ≈ despreciable.
- Corrida real de Musa: 2–5 min ≈ 0.4–1.3 créditos ⇒ 20 corridas/mes ≈ 25 créditos (8%).
- **Riesgo:** maratones de agente en background (lo que quemó agosto a principio de mes).
  La cuota mensual v27 también frena esto: un workspace bloqueado por cuota no puede
  alimentar corridas.

---

## 4. Señales de alarma (qué vigilar y cuándo actuar)

| Señal | Umbral | Acción |
|---|---|---|
| Email Netlify 50% | día ~15 del mes | revisar Usage → Functions; subir cuota de workspaces ruidosos no, BAJARLA |
| Email Netlify 75% | — | apagar batch horario (Configuración → Plataforma) si no es crítico |
| Email 100% | — | todo se suspende hasta el día 1: NO llegar acá |
| Meter "Uso del mes" rojo | >85% de cuota | el workspace ya está auto-limitado (fail-closed por diseño) |
| Bandwidth > 60 GB | — | desactivar deploy previews (palanca #4) |

---

## 5. Palancas ya implementadas (en orden de impacto)

1. **Poll del Kanban visibility-aware 30s** (v27) — mató ~30K/mes por pestaña estacionada.
2. **Cuota mensual por workspace** (v27, default 5,000, 0 = ∞) — techo duro por cuenta;
   configurable en Configuración → Plataforma, efectiva al instante.
3. **Smart tick de Musa** (v27) — si nadie tiene `auto_process_enabled` o el switch global
   está off, el tick cuesta 1 invocación y 0 background runs. Kill switches: env
   `MUSA_TICK_ENABLED=false` (emergencia, gana sobre todo) y el switch de Plataforma.
4. **Deploy previews off** (dashboard de Netlify → Site settings → Builds & deploys):
  ~150 previews × 23.3 MB ≈ 2.3 GB/mes de bandwidth regalado. Acción manual, no está en el repo.
5. **Intervalo del Kanban a 60s/2min** para usuarios que dejan el tablero abierto todo el día.

---

## 6. Cuándo pagar (gatillos de upgrade)

| Gatillo | Plan sugerido | Qué libera |
|---|---|---|
| >40 workspaces activos estables | Netlify Pro (~$19/mes) | 2M invocaciones + 1TB bandwidth → ~10× capacidad ≈ 400+ usuarios |
| Maratones de agente frecuentes | Netlify Pro | 12,500 GB-horas de créditos |
| DB > 400 MB (>4,000 diseños) | Supabase Pro ($25/mes) | 8GB DB + sin pausa por inactividad |

**Regla práctica:** mientras el email del 50% no llegue antes del día 15, el freemium
aguanta ~40–60 workspaces con la mezcla actual. Cuando llegue antes del día 10 dos meses
seguidos, es momento del primer plan pago.

---

## 7. Cómo medir cada mes (5 minutos)

1. Netlify → equipo Futuraria → **Usage → Functions** (rango: mes completo, no 24h).
2. Comparar contra 125K; anotar top 3 funciones.
3. Supabase → Table editor → `workspace_usage` → ordenar por `mcp_calls` DESC:
   ahí están los workspaces ruidosos, con nombre y apellido.
4. Actualizar la fila "consumo medido" de la tabla §1 de este doc.
