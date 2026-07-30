# CHECKPOINTS — Evaluación del estado final

> En sistemas multi-agente no se evalúa el camino, se evalúa el destino.
> Estos son los checkpoints objetivos que un juez (humano o IA reviewer) puede
> usar para decidir si la feature está sana.
>
> El reviewer recorre cada uno, llama `harness_evaluate_checkpoint`, y rechaza
> el cierre si quedan boxes sin pasar.

## C1 — El entorno está listo

- [ ] `harness_healthcheck()` retorna `ok: true`.
- [ ] MCP responde a `tools/list` con las `harness_*` tools visibles.
- [ ] Supabase responde y las tablas del harness existen.

## C2 — La feature cumple acceptance criteria

- [ ] Cada item del array `acceptance` de la task tiene un
      `harness_evaluate_checkpoint` con `passed: true`.
- [ ] Si la acceptance mencionaba un archivo o función, existe y es referenciable.
- [ ] Si la acceptance mencionaba comportamiento, hay evidence (network log,
      screenshot, lint result).

## C3 — Calidad geométrica (para features de diseño)

- [ ] `harness_healthcheck({ templateId })` muestra `lint_design_template: passed`.
- [ ] Ningún frame tiene `outsideFrame` issues.
- [ ] Ningún texto está clipped (`clippedText`).
- [ ] Ningún decorativo se solapa con texto (`overlapsText`).

## C4 — Persistencia (para features que modifican datos)

- [ ] Reload del editor NO pierde datos.
- [ ] El template aparece en el dashboard tras guardar.
- [ ] Si se creó un brand_guideline, `verify_design_system` lo encuentra.

## C5 — La sesión se cerró bien

- [ ] `harness_submit_for_review` fue llamado antes de `done`.
- [ ] `harness_complete_feature` cerró la sesión (`status: completed`).
- [ ] No hay `harness_sessions` colgadas en `active` para esta task.
- [ ] El Kanban UI muestra la card en la columna `done` (Realtime).

---

**Cómo usar este archivo:** el agente reviewer recorre cada checkpoint, llama
`harness_evaluate_checkpoint({ taskId, checkpointId: "C1", ... })` por cada uno,
y emite su veredicto. Si algún C1-C5 falla, el veredicto es `CHANGES_REQUESTED`.

Los `checkpointId` siguen el formato `C<n>` (transversales) o `C<n>_<item>`
(para acceptance criteria específicos dentro de C2).
