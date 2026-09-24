// Seed del router Musa: 1 grafo router + 4 módulos (el de diseño reusa los 6 playbooks existentes).
const BASE = 'http://localhost:4310/api/graph';

const g = (name, title, nodes, edges, subgraphs = []) => ({ name, body: { title, direction: 'TD', nodes, edges, subgraphs } });
const n = (id, label, shape = 'rect', x = null, y = null, link = undefined) => ({ id, label, shape, x, y, link });
const e = (s, t, label = '') => ({ source: s, target: t, label });

const graphs = [

  // ===== ROUTER =====
  g('musa-router', 'Musa — Router de intención (1 prompt → 4 módulos)', [
    n('P1', 'Prompt del usuario', 'round', 0, 0),
    n('C1', 'Clasificar intencional', 'diamond', 0, 160),
    n('MD', 'Módulo DISEÑO', 'rect', -520, 340, 'musa-mod-diseno'),
    n('MC', 'Módulo COPYWRITING', 'rect', -180, 340, 'musa-mod-copywriting'),
    n('MG', 'Módulo CONFIGURACIÓN', 'rect', 180, 340, 'musa-mod-config'),
    n('MT', 'Módulo CONTACTOS', 'rect', 520, 340, 'musa-mod-contactos'),
    n('AMB', 'Ambiguo: preguntar al humano (1 pregunta, opciones)', 'diamond', 0, 340),
    n('OUT', 'Ejecutar módulo y reportar resultado', 'round', 0, 560),
  ], [
    e('P1', 'C1'),
    e('C1', 'MD', 'diseñar / template / marca'),
    e('C1', 'MC', 'redactar / grilla de contenidos'),
    e('C1', 'MG', 'conectar IA / configurar'),
    e('C1', 'MT', 'venta / cliente / prospecto'),
    e('C1', 'AMB', 'no claro'),
    e('AMB', 'C1', 'respuesta'),
    e('MD', 'OUT'), e('MC', 'OUT'), e('MG', 'OUT'), e('MT', 'OUT'),
  ]),

  // ===== MÓDULO DISEÑO =====
  g('musa-mod-diseno', 'Módulo DISEÑO — reusa los 6 playbooks canónicos', [
    n('D1', 'Brief visual del usuario', 'round', 0, 0),
    n('D2', 'Clasificar entrega', 'diamond', 0, 150),
    n('DR', 'replicate-html (trajo HTML+CSS)', 'rect', -560, 330, 'musa-pb-replicate-html'),
    n('DC', 'create-from-scratch (idea/referencia)', 'rect', -340, 330, 'musa-pb-create-from-scratch'),
    n('DB', 'csv-batch (filas + template base)', 'rect', -90, 330, 'musa-pb-csv-batch'),
    n('DS', 'design-system (templateIds + marca)', 'rect', 170, 330, 'musa-pb-design-system'),
    n('DM', 'multi-agent (paralelo por secciones)', 'rect', 410, 330, 'musa-pb-multi-agent'),
    n('D3', 'Ejecutar playbook SOLO del match (no cargar los otros 5)', 'rect', 0, 510),
    n('D4', 'lint_design ≥ 70', 'diamond', 0, 660),
    n('D5', 'Fix y retry (máx 2 ciclos)', 'rect', 260, 660),
    n('D6', 'Render + QA visual (screenshot)', 'rect', 0, 810),
    n('D7', 'Humano aprueba en UI', 'diamond', 0, 960),
    n('D8', 'Export / publicar', 'round', 0, 1110),
  ], [
    e('D1', 'D2'),
    e('D2', 'DR'), e('D2', 'DC'), e('D2', 'DB'), e('D2', 'DS'), e('D2', 'DM'),
    e('DR', 'D3'), e('DC', 'D3'), e('DB', 'D3'), e('DS', 'D3'), e('DM', 'D3'),
    e('D3', 'D4'),
    e('D4', 'D5', 'fail'), e('D5', 'D4'),
    e('D4', 'D6', 'pass'),
    e('D6', 'D7'),
    e('D7', 'D8', 'ok'), e('D7', 'D3', 'cambios'),
  ]),

  // ===== MÓDULO COPYWRITING =====
  g('musa-mod-copywriting', 'Módulo COPYWRITING — posts y grillas de contenido', [
    n('K1', 'Brief de contenido', 'round', 0, 0),
    n('K2', '¿Qué formato?', 'diamond', 0, 150),
    n('K3', 'Post único (1 pieza)', 'rect', -200, 330),
    n('K4', 'Grilla (semana / mes)', 'rect', 200, 330),
    n('K5', 'Cargar contexto de marca: design system + brand manual (1 lectura, cachear)', 'rect', 0, 490),
    n('K6', 'Redactar 3 opciones por pieza (tono de la marca)', 'rect', 0, 640),
    n('K7', 'Humano elige/edita en UI', 'diamond', 0, 790),
    n('K8', 'Iterar solo las piezas rechazadas', 'rect', 260, 790),
    n('K9', 'Grilla aprobada → calendario / CSV', 'rect', 0, 940, 'musa-pb-content-calendar'),
    n('K10', 'Diseñar piezas → pasa a módulo DISEÑO', 'round', 0, 1090, 'musa-mod-diseno'),
  ], [
    e('K1', 'K2'),
    e('K2', 'K3', '1 pieza'), e('K2', 'K4', 'varias'),
    e('K3', 'K5'), e('K4', 'K5'),
    e('K5', 'K6'),
    e('K6', 'K7'),
    e('K7', 'K8', 'rechazo parcial'), e('K8', 'K7'),
    e('K7', 'K9', 'aprobado (solo si es grilla)'),
    e('K9', 'K10'),
  ]),

  // ===== MÓDULO CONFIGURACIÓN =====
  g('musa-mod-config', 'Módulo CONFIGURACIÓN — conectar IAs, claves, automatización', [
    n('G1', 'Petición de configuración', 'round', 0, 0),
    n('G2', '¿Qué configuras?', 'diamond', 0, 150),
    n('G3', 'Conectar IA (API key de proveedor: OpenAI, Z.ai, etc.)', 'rect', -420, 330),
    n('G4', 'MCP server (URL + x-api-key fdr_ws_*)', 'rect', -140, 330),
    n('G5', 'Workspace / claves API de Musa', 'rect', 140, 330),
    n('G6', 'Cronjobs / automatizaciones', 'rect', 400, 330),
    n('G7', 'Validar credencial con 1 llamada real (nunca guardar a ciegas)', 'rect', 0, 510),
    n('G8', '¿Validó?', 'diamond', 0, 660),
    n('G9', 'Reportar error exacto al humano (no reintentar en loop)', 'rect', 260, 660),
    n('G10', 'Guardar + confirmar qué quedó activo', 'round', 0, 810),
  ], [
    e('G1', 'G2'),
    e('G2', 'G3'), e('G2', 'G4'), e('G2', 'G5'), e('G2', 'G6'),
    e('G3', 'G7'), e('G4', 'G7'), e('G5', 'G7'), e('G6', 'G7'),
    e('G7', 'G8'),
    e('G8', 'G9', 'fail'), e('G8', 'G10', 'ok'),
  ]),

  // ===== MÓDULO CONTACTOS =====
  g('musa-mod-contactos', 'Módulo CONTACTOS — CRM: ventas, clientes, prospectos', [
    n('T1', 'Petición sobre contacto/venta', 'round', 0, 0),
    n('T2', '¿Entidad?', 'diamond', 0, 150),
    n('T3', 'Venta (deal)', 'rect', -260, 330),
    n('T4', 'Cliente', 'rect', 0, 330),
    n('T5', 'Prospecto (lead)', 'rect', 260, 330),
    n('T6', '¿Acción?', 'diamond', 0, 490),
    n('T7', 'Actualizar etapa / estado', 'rect', -390, 670),
    n('T8', 'Agregar nota', 'rect', -130, 670),
    n('T9', 'Reagendar follow-up', 'rect', 130, 670),
    n('T10', 'Crear nuevo', 'rect', 390, 670),
    n('T11', 'Escribir en CRM', 'rect', 0, 830),
    n('T12', 'Readback: releer el registro y comparar', 'rect', 0, 980),
    n('T13', '¿Coincide?', 'diamond', 0, 1130),
    n('T14', 'Confirmar al humano con el diff exacto', 'round', 0, 1280),
  ], [
    e('T1', 'T2'),
    e('T2', 'T3'), e('T2', 'T4'), e('T2', 'T5'),
    e('T3', 'T6'), e('T4', 'T6'), e('T5', 'T6'),
    e('T6', 'T7'), e('T6', 'T8'), e('T6', 'T9'), e('T6', 'T10'),
    e('T7', 'T11'), e('T8', 'T11'), e('T9', 'T11'), e('T10', 'T11'),
    e('T11', 'T12'),
    e('T12', 'T13'),
    e('T13', 'T14', 'ok'), e('T13', 'T11', 'mismatch: 1 retry'),
  ]),
];

for (const { name, body } of graphs) {
  const res = await fetch(`${BASE}?name=${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  console.log(name, res.status, out.ok ? 'ok' : out.error);
}
