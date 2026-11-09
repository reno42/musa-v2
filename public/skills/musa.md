---
name: musa
description: Punto de entrada para cualquier IA conectada a Musa. Explica cómo están organizadas las skills, a cuál ir según el pedido, la profesión o el entregable, y las herramientas base que sirven en todos los módulos.
module: todos
---

# Musa · empieza aquí

Musa reemplaza el stack completo de marketing de una agencia o marca: planear, diseñar, producir video, publicar, conversar, anunciar, vender, medir y automatizar. Todo lo que una persona hace en la web, su IA lo puede hacer por MCP (500+ herramientas), y viceversa.

**No leas el catálogo completo de herramientas.** Cada módulo tiene su propia skill con la lista exacta de herramientas que usa y cómo combinarlas. Carga solo la skill del trabajo que te piden:

- `list_skills()` → índice de skills (nombre, módulo, para qué sirve). Pesa muy poco.
- `get_skill({ name })` → la guía de un módulo con su lista de herramientas. Agrega `schemas: true` si necesitas los parámetros exactos de esas herramientas sin pedir `tools/list` entero.
- Si tu cliente carga `tools/list` en contexto, conéctate a `/mcp?skills=diseno,marcas` (nombres de skill separados por coma) y solo verás las herramientas de esas skills más las herramientas base.

Las skills son las mismas para todas las personas y en todos los planes. Lo que cambia por plan son los límites (marcas, personas, créditos), no lo que la IA sabe hacer.

## Primeros pasos en cualquier pedido

1. `whoami` si no sabes con qué cuenta estás conectado.
2. `list_workspaces` → elige el espacio. Guarda el `workspaceId`; casi todas las herramientas lo piden.
3. Si mencionan una marca por nombre: `resolve_brand({ workspaceId, brand })` primero. Devuelve paleta, tipografías, estrategia y sus archivos contenedores.
4. Si necesitas contexto amplio (qué hay en el espacio): `brain_vault({ workspaceId, bodies: false })` da un índice liviano de todo.
5. Carga la skill del módulo y sigue su flujo.
6. Verifica el resultado real (relee el registro, renderiza el diseño) antes de decir que terminaste. Comunica IDs y enlaces reales.

## A qué skill ir

| Módulo del menú | Skill | Cuándo |
|---|---|---|
| Inicio › Resumen, Mi trabajo, Segundo cerebro | `musa-inicio` | Qué pasa hoy, pendientes, tareas, notas y memoria del espacio |
| Organización › Áreas, Aprobaciones, Agencias | `musa-organizacion` | Empresas con varias áreas, aprobación de piezas, agencias externas |
| Planear › Investigación, Briefs, Calendario, Playbooks | `musa-planear` | Fuentes y noticias, briefs de clientes, playbooks, grilla de contenidos |
| (transversal) Copys | `musa-copy` | Redactar, reescribir, traducir, recetas de escritura |
| Crear › Marcas | `musa-marcas` | Identidad, design system, estrategia y voz, tokens, chequeo de marca |
| Crear › Diseños | `musa-diseno` | Crear y editar piezas: posts, carruseles, decks, banners, formatos |
| Crear › Diseños (archivo) | `musa-diseno-biblioteca` | Importar (Figma, SVG, PSD), lotes CSV, recetas, versiones, etiquetas, comentarios |
| Crear › Diseños (vectores) | `musa-vectores` | Pluma, trazados, buscatrazos, máscaras, vectorizar |
| Crear › Diseños (fotos) | `musa-fotos` | Revelado, composición por capas, quitar fondo, generar imágenes |
| Crear › Video y motion, Tomas, Clones IA | `musa-video` | Reels, animación, timeline, guiones de teleprompter, voz clonada |
| Crear › Mailing, Eventos, Formularios | `musa-mailing-eventos` | Correos (crear, probar, enviar), secuencias, eventos, formularios |
| Crear › Automatizaciones | `musa-automatizaciones` | Flows: fuentes → IA → diseño → reporte |
| Conversar › Bandeja; publicar en redes | `musa-redes` | Publicar o programar, responder y asignar DMs y comentarios, captar leads |
| Anunciar › Campañas, Audiencias, Presupuesto | `musa-anunciar` | Pauta pagada: planificar, sincronizar, crear, pausar |
| Vender › Oportunidades, Personas, Empresas, Cotizaciones; Clientes › Proyectos, Fees; portal | `musa-vender` | CRM, cotizaciones, fees, proyectos, accesos de clientes |
| Medir › Reportes, Embudos, Loops, Ads | `musa-medir` | Métricas, embudos reales, growth loops, reportes |
| Agentes › Chats, Computadoras, Skills, Gobernanza | `musa-agentes` | Agentes del espacio, políticas de IA, trabajo entre agentes, bitácora |
| Configuración | `musa-configuracion` | Cuenta, equipo, llaves, integraciones, papelera |

### Por profesión (qué skills combinar)

- **Community manager**: `musa-planear` → `musa-copy` → `musa-diseno` → `musa-redes` (y `musa-medir` para el reporte).
- **Diseñador/a**: `musa-marcas` → `musa-diseno` (+ `musa-vectores`, `musa-fotos`, `musa-diseno-biblioteca`).
- **Editor/a de video o motion**: `musa-video` (+ `musa-diseno` si parte de un diseño).
- **Copywriter**: `musa-copy` + `musa-marcas` (voz y estrategia).
- **Ejecutivo/a comercial o de cuentas**: `musa-vender` (cotizaciones, fees, proyectos) + `musa-planear` (briefs) + `musa-inicio` (pendientes).
- **Growth / performance**: `musa-anunciar` + `musa-medir` + `musa-automatizaciones` + `musa-mailing-eventos`.
- **Líder de marketing en una empresa**: `musa-organizacion` + `musa-marcas` + `musa-medir`.
- **Dueño/a de agencia o líder de marketing**: `musa-inicio` (resumen) + `musa-medir` + `musa-vender`.
- **Operaciones / técnico**: `musa-automatizaciones` + `musa-configuracion` + `musa-agentes`.

### Por entregable

- Post, carrusel, story, banner, deck → `musa-diseno`
- El mismo diseño en muchos formatos o 100 variantes desde un CSV → `musa-diseno` (formatos) / `musa-diseno-biblioteca` (lotes)
- Logo, ícono, ilustración vectorial → `musa-vectores`
- Foto retocada o imagen generada → `musa-fotos`
- Reel, video animado, video desde un diseño → `musa-video`
- Calendario del mes, ideas, textos de publicación → `musa-planear` + `musa-copy`
- Manual de marca, tokens, design system → `musa-marcas`
- Correo, newsletter, secuencia, evento, formulario → `musa-mailing-eventos`
- Brief, playbook → `musa-planear`; cotización, fee, proyecto → `musa-vender`
- Campaña de ads → `musa-anunciar`; aprobación de una pieza → `musa-organizacion`
- Publicación en redes, respuestas a la bandeja → `musa-redes`
- Oportunidad, contacto, seguimiento, acceso de cliente → `musa-vender`
- Reporte, embudo, KPIs → `musa-medir`
- Proceso repetible (cada semana, con varias fuentes) → `musa-automatizaciones`

## Herramientas base (sirven en todos los módulos)

- `list_skills`: índice de skills.
- `get_skill`: guía de una skill, con sus herramientas (y sus parámetros si pides `schemas: true`).
- `whoami`: identidad de la sesión (persona, modo, cantidad de espacios).
- `list_workspaces`: espacios a los que tienes acceso.
- `resolve_brand`: contexto completo de una marca por nombre o ID. Úsala primero cuando nombran una marca.
- `brain_vault`: todo el espacio en una llamada (marcas, diseños, piezas, CRM, notas). `bodies: false` para un índice liviano.
- `editor_open`: devuelve el enlace para que la persona abra un diseño o video en su editor.
- `get_agent_guide`: guía breve de conexión y método.
- `verify_api_key`: diagnostica un 401 (llave inexistente, revocada o vencida). No crees llaves nuevas si ya tienes una.
- `get_editor_guide`: atajos y comportamiento del editor humano, para explicarle a la persona.
- `report_bug`: reporta un fallo de Musa con pasos exactos.

## Reglas que aplican siempre

- **Nada se dispara solo.** Musa no tiene envíos ni publicaciones automáticas: los flows son de disparo manual y publicar, enviar correos o mover pauta pasa solo cuando la persona lo pide (esas herramientas piden `confirm: true`). No intentes programar crons ni webhooks de entrada.
- **Gobernanza.** Si el espacio tiene políticas de IA (`list_governance`, skill `musa-agentes`), mandan sobre cualquier pedido.
- **BYOK.** La IA de imagen, video y voz usa las llaves del espacio. Si una herramienta responde que falta la llave, dile a la persona que la agregue en Configuración › Integraciones; no inventes un resultado.
- **No borres sin pedirlo.** Las herramientas destructivas (borrar diseño, toma, flow, contenido) solo con confirmación explícita.
- **Respeta la marca.** Si `get_active_styles` devuelve estilos bloqueados, úsalos tal cual.
- **No crees espacios.** `create_workspace` está desactivada: los espacios los crea la persona.
- **Conserva textos exactos** cuando la persona te los da.
- **Skills guardadas en tu memoria: anota su `skillsVersion`.** Llega en el saludo del MCP (`initialize`) sin costo. Si cambió, llama `list_skills()` y relee con `get_skill` solo las que tengan otra `version`. Si no guardas skills entre conversaciones, no hace falta revisar nada: `get_skill` siempre entrega la vigente.
- **Trabaja por el MCP, no por la pantalla.** Si manejas un navegador, no uses los menús de Musa para lo que el MCP ya hace (importar, exportar, publicar): son más lentos y abren selectores de archivos. Si igual usas la interfaz, Musa no abre ventanas nativas: sus diálogos son `[data-musa-dialog]` con botones `[data-action="ok"|"cancel"]`, y los menús del editor tienen `data-action` estable (p. ej. `[data-action="pegar-html"]`).

## Herramientas que no debes usar

Siguen en el catálogo por compatibilidad, pero están desactivadas o reemplazadas en esta versión:

- `create_workspace`: desactivada, la persona crea los espacios.
- `task_queue_add`, `task_queue_list`: obsoletas; usa `studio_create_card` y `studio_list_cards` (skill `musa-inicio`).
- `flow_wake_set`, `flow_wake_get`, `flow_wake_test`, `flow_due_check`, `flow_webhook_rotate`: los flows no tienen disparo por webhook ni por horario.
- `harness_create_cronjob`, `harness_toggle_cronjob`, `harness_list_cronjobs`: sin tareas programadas.
- `get_nda_status`: el acuerdo alfa ya no aplica.
- `chatfab_log_decision`: telemetría interna del asistente de la web.
- `register_tool`: no registres herramientas propias; si necesitas otro servicio, conéctalo como integración y usa `call_workspace_mcp`.

## Ejemplos

- "¿Qué puedes hacer en Musa?"
- "Arma la campaña de lanzamiento de Café Altura: calendario, piezas, correo y evento"
- "Soy community manager, ayúdame con la semana de Kuna Studio"
