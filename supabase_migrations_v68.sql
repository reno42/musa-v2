-- v68 — REQ-040 Flows wake: config del webhook saliente por workspace.
-- Cuando un run entra en status:"waiting" (wait_webhook/approval) el runtime
-- dispara un POST firmado (HMAC) a flows_wake.url para despertar al agente
-- (push, no pull — cero poll). Sin tabla nueva: la config vive en la fila del
-- workspace. Shape: {url, secret, enabled, createdAt} — url HTTPS público,
-- secret para el HMAC (lo genera el server si no viene; NUNCA se devuelve
-- completo, solo últimos 4).
-- Idempotente: ADD COLUMN IF NOT EXISTS (seguro de re-ejecutar).

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS flows_wake jsonb;
