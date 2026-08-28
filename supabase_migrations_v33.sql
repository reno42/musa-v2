-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v33 — Copy Recipes: defaults de fábrica + privacidad (REQ-020)
--
-- La biblioteca de recetas pasa a tener dos niveles:
--   1) DEFAULTS: 10 frameworks clásicos sembrados aquí, visibles para
--      TODAS las cuentas (is_default = TRUE, sin owner). Solo lectura:
--      nadie puede editarlas ni borrarlas (si se editara, cambiaría
--      para todos los usuarios).
--   2) PERSONALES: cualquier receta guardada por un humano (REST) o una
--      IA (MCP) pertenece a UN usuario (owner_id) y es exclusivamente
--      suya — ni siquiera compañeros del mismo workspace la ven.
--
-- Los rows existentes (creados bajo v32, sin owner) se asignan al owner
-- del workspace: en la práctica el creador es el dueño de la cuenta.
--
-- Requiere v32 (tabla copy_recipes). Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

-- 1) Columnas nuevas ──────────────────────────────────────────────
ALTER TABLE copy_recipes ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE copy_recipes ADD COLUMN IF NOT EXISTS owner_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN copy_recipes.is_default IS
  'TRUE = framework de fábrica compartido por todas las cuentas (sembrado por la migración, solo lectura).';
COMMENT ON COLUMN copy_recipes.owner_id IS
  'Usuario dueño de la receta personal. NULL + is_default FALSE solo si el backfill no pudo resolver el owner.';

-- 2) Backfill: lo existente pasa a ser personal del owner del workspace ──
-- workspaces.owner_id es TEXT (herencia de las tablas de tenancy), mientras
-- que copy_recipes.owner_id es UUID: hace falta el cast explícito. El regex
-- guarda el cast — un owner_id malformado salta la fila en vez de romper
-- toda la migración.
UPDATE copy_recipes r
SET    owner_id = w.owner_id::uuid
FROM   workspaces w
WHERE  r.workspace_id = w.id
  AND  r.owner_id IS NULL
  AND  NOT r.is_default
  AND  w.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 3) Índices ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_crx_defaults ON copy_recipes (is_default) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_crx_owner    ON copy_recipes (owner_id)  WHERE owner_id IS NOT NULL;

-- 4) RLS: defaults para todos; personales solo para su dueño ──────
ALTER TABLE copy_recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "copy_recipes_read" ON copy_recipes;
CREATE POLICY "copy_recipes_read" ON copy_recipes
  FOR SELECT USING (is_default OR owner_id = auth.uid());

DROP POLICY IF EXISTS "copy_recipes_write" ON copy_recipes;
CREATE POLICY "copy_recipes_write" ON copy_recipes
  FOR ALL USING (NOT is_default AND owner_id = auth.uid())
  WITH CHECK (NOT is_default AND owner_id = auth.uid());

-- 5) Los 10 frameworks default (id fijo → re-ejecutar no duplica) ──
INSERT INTO copy_recipes (id, workspace_id, type, name, content, tags, source, is_default, owner_id) VALUES
(
  'crx_def_aida',
  'default', 'framework', 'AIDA (Atención–Interés–Deseo–Acción)',
  E'Estructura de venta clásica de cuatro pasos.\n1) Atención: abre con el dolor o el deseo concreto del lector.\n2) Interés: da un dato o ángulo nuevo que sostenga la lectura.\n3) Deseo: muestra el resultado de usar el producto (beneficio, no función).\n4) Acción: un solo CTA claro, con urgencia real.\nEjemplo: «¿Publicas todos los días y no vendes? La mayoría confunde alcance con conversión. Con un calendario guiado, tus posts dejan de ser suerte. Prueba Futuraria gratis hoy.»',
  ARRAY['clásico','ventas'], 'humano', TRUE, NULL
),
(
  'crx_def_pas',
  'default', 'framework', 'PAS (Problema–Agitación–Solución)',
  E'1) Problema: nombra el dolor exacto con las palabras del lector.\n2) Agitación: muestra el costo de no resolverlo (tiempo, dinero, oportunidades perdidas).\n3) Solución: presenta el producto como el puente y cierra con CTA.\nEjemplo: «Pierdes 3 horas por post en diseñar a mano. Eso son 90 horas al mes que nadie te devuelve. Con plantillas editables publicas en 10 minutos.»',
  ARRAY['clásico','conversión'], 'humano', TRUE, NULL
),
(
  'crx_def_bab',
  'default', 'framework', 'Antes–Después–Puente (BAB)',
  E'1) Antes: describe la situación actual con su fricción.\n2) Después: pinta la vida ideal tras la solución (sensorial y específica).\n3) Puente: tu producto es cómo se llega de una a la otra.\nEjemplo: «Hoy saltas entre 4 herramientas y la campaña igual se cae. Mañana: un tablero, tu IA y toda la semana aprobada. Eso hace Futuraria.»',
  ARRAY['storytelling'], 'humano', TRUE, NULL
),
(
  'crx_def_4p',
  'default', 'framework', 'Las 4 P (Promesa–Panorama–Prueba–Empuje)',
  E'1) Promesa: el resultado concreto que el lector obtendrá.\n2) Panorama: haz que se visualice usándolo.\n3) Prueba: evidencia — números, testimonios, garantía.\n4) Empuje: CTA con escasez o bono real.\nEjemplo: «Duplica tu contenido en la mitad del tiempo. Imagina abrir la semana con todo aprobado el lunes. +2.400 marcas ya lo hacen. Empieza gratis antes del fin de mes.»',
  ARRAY['ventas','anuncios'], 'humano', TRUE, NULL
),
(
  'crx_def_fab',
  'default', 'framework', 'FAB (Característica–Ventaja–Beneficio)',
  E'Para describir funcionalidades sin sonar a ficha técnica.\n1) Característica: qué es.\n2) Ventaja: qué hace mejor o distinto.\n3) Beneficio: qué gana el usuario de verdad.\nEjemplo: «Editor visual con IA (qué es) → genera 3 variantes por brief (qué hace distinto) → eliges en minutos, no en tardes (qué ganas)».',
  ARRAY['producto'], 'humano', TRUE, NULL
),
(
  'crx_def_sb7',
  'default', 'framework', 'StoryBrand SB7',
  E'El cliente es el héroe; la marca, el guía (Donald Miller).\n1) Un héroe con un problema. 2) El héroe encuentra un guía. 3) El guía le da un plan. 4) Lo llama a la acción. 5) Le muestra cómo evitar el fracaso. 6) Y visualiza el éxito. 7) La marca sobrevive su propia transformación.\nRegla práctica: la marca nunca es protagonista; usa «tú» mucho más que «nosotros».',
  ARRAY['storytelling','marca'], 'humano', TRUE, NULL
),
(
  'crx_def_pastor',
  'default', 'framework', 'PASTOR',
  E'Para cartas de venta largas y lanzamientos (Ray Edwards).\nP — Persona: a quién le hablas, en detalle.\nA — Amplificación: qué empeora si no actúa.\nS — Story: historia de transformación creíble.\nT — Testimonio/Transformación: prueba de que funciona.\nO — Oferta: qué incluye y su valor apilado.\nR — Respuesta: el CTA con riesgo reducido.',
  ARRAY['lanzamientos','carta de venta'], 'humano', TRUE, NULL
),
(
  'crx_def_hso',
  'default', 'framework', 'Hook–Historia–Oferta (HSO)',
  E'Estructura para anuncios y videos cortos.\n1) Hook: primera línea/segundo que detiene el scroll (dato, pregunta o resultado).\n2) Historia: conflicto → giro → descubrimiento del producto.\n3) Oferta: qué recibe, riesgo cero y CTA.\nEjemplo: «Gasté $2.000 en anuncios con 3 ventas (hook). Descubrí que el problema era el copy, no el alcance (historia). Con las recetas de Futuraria: ROAS 3.1 en dos semanas (oferta).»',
  ARRAY['anuncios','video'], 'humano', TRUE, NULL
),
(
  'crx_def_4u',
  'default', 'hook', 'Las 4 U para hooks',
  E'Filtro de Michael Masterson para titulares y primeras líneas. Debe cumplir 3 de 4:\n1) Útil: promete un beneficio concreto.\n2) Única: ángulo que la competencia no repite.\n3) Urgente: motivo para leer HOY.\n4) Ultra-específica: números, plazos o detalles verificables.\nEjemplo: «Cómo 12 diseñadores freelance entregan 30% más proyectos por semana (sin trabajar de noche)».',
  ARRAY['hooks','titulares'], 'humano', TRUE, NULL
),
(
  'crx_def_acca',
  'default', 'framework', 'ACCA (Conciencia–Comprensión–Convicción–Acción)',
  E'Prima del AIDA para temas complejos o públicos fríos (el lector aún no sabe que tiene el problema).\n1) Conciencia: saca a la luz el problema.\n2) Comprensión: explícalo simple, sin jerga.\n3) Convicción: argumentos y prueba de que se resuelve.\n4) Acción: un paso concreto y pequeño.\nEjemplo B2B: «El 70% de tus leads no responde. No es el precio: es el copy. Mira por qué…»',
  ARRAY['clásico','b2b'], 'humano', TRUE, NULL
)
ON CONFLICT (id) DO NOTHING;
