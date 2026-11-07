---
name: musa-configuracion
description: Configuración de Musa. Cuenta y perfil, espacios, equipo e invitaciones, llaves de API y de IA (BYOK), webhooks, fuentes propias, papelera y almacenamiento, conexión con Figma y diagnóstico. Úsala para administrar la cuenta o resolver problemas de acceso.
module: configuracion
---

# Configuración · cuenta, equipo, llaves y papelera

## Flujos

**¿Con quién estoy conectado?**
- `whoami` → persona, modo de sesión y cantidad de espacios. `list_workspaces` para los espacios.

**Equipo**
- `manage_invites({ workspaceId, action: "list" | "invite" | "revoke", email, role })`.
- Renombrar un espacio: `update_workspace({ workspaceId, name })`. Crear espacios lo hace la persona en la web.

**Llaves de acceso para agentes**
- `list_api_keys({ workspaceId })`, `create_api_key({ workspaceId, label, role })` (la llave se ve una sola vez), `revoke_api_key`.
- Si una llave falla: `verify_api_key` antes de crear otra.
- `ai_connect_prompts`: la guía para conectar otra IA a Musa (la misma de Configuración › Conecta tu IA).

**Llaves de IA (BYOK)**
- `manage_byok_keys({ action: "list" | "set" | "delete", provider, key, model })`: las llaves personales (Gemini, Runway, WaveSpeed, ElevenLabs, Quiver…) quedan cifradas. Las herramientas de IA de las demás skills las usan.

**Webhooks salientes personales**
- `manage_webhooks({ action, url, events })`: avisos firmados de eventos internos.

**Perfil y onboarding**
- `update_profile` (nombre, teléfono, web, preferencias), `manage_onboarding` (metas y pasos), `get_referral_status` (código de referidos y premios).

**Fuentes propias**
- `font_upload_custom({ fileName, dataBase64 })` (ttf, otf, woff, woff2; hasta 2 MB), `font_list_custom`, `font_delete_custom`, `font_usage_custom` (uso contra el límite del plan).

**Papelera y almacenamiento**
- `trash_files({ workspaceId, action: "list" | "trash" | "restore", ids })`. La papelera no se vacía sola en esta versión.
- `storage_health()`: diagnóstico de base de datos, tiempo real y almacenamiento.

**Figma**
- `figma_connection({ workspaceId })`: estado de la conexión (los imports están en `musa-diseno-biblioteca`).

**Reportar un problema**
- `report_bug({ action: "create", description, steps, severity, url })`.

**Administración de la plataforma** (solo dueños del espacio)
- `platform_get_status`, `platform_update_config`: interruptores y límites.
- `task_queue_get_config`, `task_queue_update_config`: configuración de automatización del espacio.

## Herramientas

Cuenta y espacios
- `whoami`, `list_workspaces`, `update_workspace`, `update_profile`, `manage_onboarding`, `get_referral_status`.

Equipo
- `manage_invites`.

Llaves e integraciones
- `list_api_keys`, `create_api_key`, `revoke_api_key`, `verify_api_key`, `auth_token`.
- `manage_byok_keys`, `manage_webhooks`, `list_workspace_integrations`, `figma_connection`, `ai_connect_prompts`.

Fuentes
- `font_list_custom`, `font_upload_custom`, `font_delete_custom`, `font_usage_custom`.

Papelera y diagnóstico
- `trash_files`, `storage_health`, `report_bug`.

Plataforma
- `platform_get_status`, `platform_update_config`, `task_queue_get_config`, `task_queue_update_config`.

## Reglas

- Nunca pegues llaves en el chat ni en notas; si la persona te da una, guárdala con `manage_byok_keys` o en la configuración de tu cliente.
- No crees llaves nuevas si ya tienes una que funciona.
- Plan, cobros y facturas se gestionan en Configuración › Espacios y planes, en la web.

## Ejemplos

- "Invita a ana@agencia.com como editora al espacio de Kuna"
- "Guarda mi llave de Runway para poder generar videos"
- "Restaura los diseños que borré ayer"
