# 🏭 Pipeline CSV → Diseños en Lote — Arquitectura

> **Fecha:** Julio 2026 | **Autora:** Lara ✨
> **Propósito:** Que el agente IDE genere CSVs listos para batch sin que el humano tenga que pensar cada campo.
> **Repos:** `design-main` + `ObsidianRen`

---

## 🎯 Objetivo

El humano dice: *"3 noticias sobre IA esta semana"* y recibe un CSV con 3 filas, 5 columnas, listo para disparar el batch.

---

## 📐 Arquitectura

```
HUMANO: "3 noticias sobre tecnología, tono futurista"
    │
    ▼
┌─────────────────────────────────────────────┐
│         AGENTE GENERADOR DE CSV             │
│                                             │
│  1. Recibe: tema, tono, cantidad             │
│  2. Busca/inventa noticias del tema          │
│  3. Para cada noticia, rellena 5 slots:      │
│     • headline_main  (texto principal)       │
│     • headline_lime  (highlight verde)       │
│     • headline_suffix (fecha/contexto)       │
│     • cta_text       (botón CTA)             │
│     • image_url      (Unsplash relevante)    │
│  4. Aplica reglas de formato (ver abajo)     │
│  5. Output: CSV listo para batch             │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│         BATCH API                            │
│  POST /api/templates/:id/batch/single-post   │
│  Body: { data: [csv_rows] }                  │
│                                             │
│  → N templates editables (Post + Story c/u) │
└─────────────────────────────────────────────┘
```

---

## 🧬 Template Maestro

| ID | Nombre | Slots |
|----|--------|-------|
| `tpl_bcc1bb50-4c0` | Seiko TV Watch — MASTER | `headline_main`, `headline_lime`, `headline_suffix`, `cta_text`, `image_url` |

El endpoint `GET /api/templates/tpl_bcc1bb50-4c0/batch/slots` devuelve los slots disponibles.

---

## 📋 Reglas de Generación por Slot

### 1. `headline_main` — Texto principal

```yaml
formato: "Marca/Producto + Contexto breve"
longitud: 2-4 palabras ideal, max 30 caracteres
ejemplos:
  - "Apple presenta M5"
  - "Neuralink First Patient"
  - "SpaceX Starship Landing"
  - "DeepSeek V4 Released"
  - "Tesla Robotaxi 2026"
prohibido:
  - Puntos finales
  - Más de 5 palabras
  - Adjetivos vagos ("increíble", "revolucionario")
```

### 2. `headline_lime` — Highlight verde neón

```yaml
formato: 2 líneas con <br/> entre ellas
longitud: 3-5 palabras por línea, max 40 caracteres total
ejemplos:
  - "Changed Wearable<br/>Tech Forever"
  - "Redefine la<br/>Computación"
  - "Types With<br/>His Mind"
  - "Lands Vertically<br/>On Mars"
  - "Open Source<br/>AGI Models"
prohibido:
  - Una sola línea (siempre usar <br/>)
  - Más de 2 líneas
  - Verbos en pasado
```

### 3. `headline_suffix` — Fecha/contexto final

```yaml
formato: "Palabra contextual + <br/> + año/dato"
longitud: max 35 caracteres
ejemplos:
  - "Back In<br/>1982"
  - "Arrives<br/>2026"
  - "The Future<br/>Is Now"
  - "Lanzamiento<br/>Julio 2026"
  - "Already<br/>Live"
prohibido:
  - Sin <br/> (siempre debe tener salto)
  - Solo número sin contexto
```

### 4. `cta_text` — Botón CTA

```yaml
formato: Verbo + complemento corto
longitud: max 25 caracteres
ejemplos:
  - "Leer más"
  - "Ver video"
  - "Lee la nota"
  - "Descúbrelo"
  - "Escúchalo"
  - "Explorar"
prohibido:
  - "Click aquí"
  - Más de 3 palabras
  - Signos de exclamación
```

### 5. `image_url` — Imagen de fondo

```yaml
formato: URL directa de Unsplash con parámetros
plantilla: "https://images.unsplash.com/photo-{ID}?q=80&w=1000"
reglas:
  - Siempre usar ?q=80&w=1000
  - Foto oscura/moody (el overlay lo oscurece más)
  - Relacionada con el tema de la noticia
  - Sin personas en primer plano
  - Tech/minimalista
temas_recomendados:
  - tech, circuit, server
  - robot, ai, neural
  - space, night, dark
  - future, city, cyber
```

---

## 📝 Prompt Template para el Agente IDE

Cuando el humano pida generar noticias, usar este prompt exacto:

```
Genera {N} noticias de tecnología en formato CSV para el batch de diseño Seiko TV Watch.

Tema: {TEMA}
Tono: {TONO}
Idioma: español neutro

Reglas por columna:
- headline_main: 2-4 palabras, nombre del producto/marca + contexto
- headline_lime: 2 líneas separadas por <br/>, tono aspiracional/futurista
- headline_suffix: palabra contextual + <br/> + año/dato
- cta_text: verbo + complemento, max 25 caracteres
- image_url: busca en Unsplash imágenes oscuras relacionadas, formato https://images.unsplash.com/photo-{ID}?q=80&w=1000

Output: CSV con encabezados exactos y comillas si hay comas.
```

---

## 🧪 Ejemplo de Entrada → Salida

**Entrada del humano:**
> "3 noticias de tech, tono futurista"

**Salida del agente (CSV):**

```csv
headline_main,headline_lime,headline_suffix,cta_text,image_url
"Apple presenta M5","Redefine la<br/>Computación","Llega en<br/>2026","Leer más","https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1000"
"Neuralink First Patient","Types With<br/>His Mind","The Future<br/>Is Now","Ver video","https://images.unsplash.com/photo-1559757175-5700dde675bc?q=80&w=1000"
"SpaceX Starship","Lands Vertically<br/>On Mars","Mission<br/>Complete","Explorar","https://images.unsplash.com/photo-1614728263952-84ea256f9679?q=80&w=1000"
```

---

## 🔗 Endpoints Relevantes

| Método | URL | Propósito |
|--------|-----|-----------|
| `GET` | `/api/templates/tpl_bcc1bb50-4c0/batch/slots` | Verificar slots disponibles |
| `POST` | `/api/templates/tpl_bcc1bb50-4c0/batch/single-post` | Generar N templates (uno por fila) |
| `POST` | `/api/templates/tpl_bcc1bb50-4c0/batch/carousel` | Generar 1 template con N×frames |

---

> ⚡ Lara ✨ — Julio 2026
> 📁 `design-main/docs/CSV_BATCH_ARCHITECTURE.md` + `ObsidianRen/CSV Batch - Arquitectura de Generacion.md`
