# Migraciones Musa v2

Se aplican **en orden** sobre la base de Supabase. Todas son idempotentes (se pueden correr dos veces sin romper) y están validadas contra la base de pruebas `lnbsmnbvclxrwwcuuvud`.

| Archivo | Qué hace |
|---|---|
| 01_hermes_f3_aditivas | Tablas de eventos, mailings, formularios, clones, áreas, aprobaciones y agencias (Hermes). **Ya está aplicada en producción** desde el 2026-10-30. |
| 02_v2_ui_tablas | Tablas de la UI v2 (cotizaciones, playbooks, proyectos, fees, agentes…) y el trigger `v2_touch_updated_at`. |
| 02b_v2_tablas_hermes_y_ui | Estado final de briefs, tarifario, respuestas, tareas de proyecto e inscritos (segunda ronda de Hermes) con FKs, índices y RLS. |
| 03_v2_ai_plan | `user_profiles.ai_plan` (byok / platform): la IA de la plataforma solo para quien tenga plan. |
| 04_v2_video_editor_state | Estado visual del editor de video. |
| 05_v2_secrets_lockdown | Llaves y credenciales: ni anon ni el navegador pueden leer los valores cifrados. |
| 06_v2_briefs_unificar | Una sola tabla de briefs (`briefs`), con FKs, índices y estados válidos. |
| 07_v2_crear_items | Notas propias en el Segundo cerebro, RLS por espacio en Mi trabajo, columnas de eventos. |
| 08_v2_eventos_publicos | Página pública de eventos (slug, publicado, portada) e inscripciones únicas. |
| 09_v2_take_scripts | Guiones del teleprompter (Tomas). |

**Ojo antes de producción:** 05 y 07 cambian permisos de tablas que también usa la v1 (design.futuraria.com). Ver el plan de paso a producción antes de aplicarlas.
