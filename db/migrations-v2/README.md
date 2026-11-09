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
| 10_v2_hermes_ajustes | Clones como registro, áreas / aprobaciones / agencias para Organización, FK al espacio en las tablas de Hermes. |
| 11_v2_email | Correo por espacio (Resend o Postmark), bajas de contactos y registro de envíos. |
| 12_v2_paginas_publicas | Tokens públicos de formularios, briefs y cotizaciones; firma y comentario del cliente. |
| 13_v2_cerebro | Notas propias editables y borrables; las del sistema, de solo lectura. |
| 14_v2_ads | Cuentas publicitarias por espacio y campañas sincronizadas con métricas. |
| 15_v2_terminos_lanzamientos | Términos en el registro y lanzamientos por módulo. |
| 16_v2_billing | Cobros con Creem: planes, suscripciones, eventos del webhook y premios de referidos. |
| 17_v2_perfil_protegido | El usuario no puede cambiarse el plan ni la atribución de referido. |
| 18_v2_acceso_codigos | Cobro encendible, códigos de acceso gratis (MUSAFREE) y estado de acceso. |
| 19_v2_planes_creem | Primera versión de planes (reemplazada por la 20). |
| 20_v2_planes_valor | Planes Creador / Agencia / Empresa, ofertas, créditos de IA, personas extra, paquetes y límites de marcas y personas. |
| 21_v2_creditos_recarga | Recarga mensual de créditos (también anuales), cupo de correos y reembolsos de referidos. |
| 22_v2_admin_fundador | El panel de admin guarda la fecha del precio fundador. |
| 23_v2_agencia_privacidad | Modo freelancer/agencia: `brand_guests` (clientes invitados a UNA marca), `brand_portal` (intranet), `content_comments`; `visibility`/`tags`/`created_by` en el contenido; `brands.is_house`; capa RLS restrictive (privado/compartido) + invitados solo lo compartido de su marca. **Ojo antes de producción:** enciende RLS en tablas v1 sin él (con políticas permissivas equivalentes) — probar en la DB de pruebas y verificar que design.futuraria.com sigue leyendo. |
| 28_v2_publisher | Musa Publisher (motor social propio): apps de developer, cuentas conectadas, estados OAuth, publicaciones y destinos. Solo servidor (RLS sin políticas), tokens cifrados con PUBLISHER_ENC_KEY. |
| 29_v2_publisher_agencia | Publisher para agencias: cuenta ↔ marca/cliente (`brand_id`), enlaces de conexión para el cliente (7 días, un uso), texto por red e imagen liviana por publicación. |
| 30_v2_import_html | Importar HTML: `design_import_jobs.source_type` acepta `html`, `url` y `zip`; el bucket `design-imports` acepta ZIP (subida firmada desde el editor). |

**Ojo antes de producción:** 05 y 07 cambian permisos de tablas que también usa la v1 (design.futuraria.com). Ver el plan de paso a producción antes de aplicarlas.
