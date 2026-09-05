# BRAND_STRATEGY_V1 — schema de `strategy_json`

> Spec v1 (2026-09-05). Contrato del Brand Strategy Canvas: lo que el humano
> rellena en el formulario se guarda aquí, y de aquí salen (1) el render de
> frames del archivo `Comunicación — {Marca}`, (2) la nota MD del second brain
> y (3) el digest que `get_brand_playbook` entrega a las IAs.

## Principios

- **El humano rellena, nunca escribe JSON.** El Canvas es la única UI de
  edición; `strategy_json` es almacenamiento estructurado.
- **Progresivo:** Nivel 1–2 son el "must" (must en `strategyCompleteness`);
  3–5 se llenan cuando la marca escala.
- **Determinista al serializar:** mismo JSON → mismo MD → mismo render.
- Sin valores inventados: campo vacío = ausente (no `""` en el digest).

## Schema

```jsonc
{
  "$version": 1,

  "essence": {                        // Nivel 1 — must
    "mission": "",                    // misión (≤ 280 chars sugerido)
    "vision": "",
    "values": ["", ""],               // chips
    "valueProposition": "",           // 1 línea
    "positioning": ""                 // 1 línea
  },

  "tone": {                           // Nivel 2 — must
    "axes": {                         // 0..100 (50 = neutro)
      "formalCasual": 50,             // 0 formal ↔ 100 casual
      "seriousPlayful": 50,
      "technicalSimple": 50,
      "soberExpressive": 50,
      "closeCorporate": 50
    },
    "person": "tu",                   // "tu" | "usted" | "nosotros"
    "emojiPolicy": "never"            // "never" | "occasional" | "free"
  },

  "audience": {                       // Nivel 3 — escala
    "personas": [{
      "name": "", "age": "", "role": "",
      "pains": [""], "goals": [""],
      "channels": [""],               // instagram, tiktok, email…
      "winningMessage": ""            // ejemplo de mensaje que le funciona
    }]
  },

  "voice": {                          // Nivel 4 — escala
    "vocabularyYes": [""],
    "vocabularyNo": [""],
    "bannedTells": [""],              // muletillas IA prohibidas (AI_TELLS-copy)
    "hookStructures": [""],
    "ctaPatterns": [""],
    "lengthByChannel": { "instagram": "", "email": "" }
  },

  "advanced": {                       // Nivel 5 — opcional
    "archetype": "",
    "competitors": [""],
    "references": [""],
    "funnelMessages": [{ "stage": "", "message": "" }]
  }
}
```

## Reglas de validación (servidor)

- `tone.axes.*` enteros 0–100; `tone.person`/`emojiPolicy` del enum; el resto
  strings/arrays libres. Desconocidos → rechazados (sin pass-through).
- `update_brand_strategy` hace merge por sección (`{ tone: {...} }` no pisa
  `essence`), graba `updated_at` y dispara: re-render de frames Comunicación,
  upsert de nota brain, invalidación del digest de playbook.

## Digest para IAs (lo que ve `get_brand_playbook`)

Bloque `strategy` en texto plano, omitiendo lo vacío:

```
Voz: casual (78%), lúdico (65%), tuteo, sin emojis.
Esencia: promesa "…". Valores: cercanía, precisión.
Personas: Laura (28, diseñadora) — dolor: … — gancho que funciona: …
Prohibido: "en el mundo de…", "sumérgete".
```
