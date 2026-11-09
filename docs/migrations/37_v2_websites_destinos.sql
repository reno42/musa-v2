-- 37_v2_websites_destinos.sql — Websites: más conexiones por sitio
--
-- website_secrets guarda (cifradas AES-256-GCM, solo servidor) las llaves de cada conexión de un website.
-- Se suman Netlify, Cloudflare Pages (subir el sitio con un clic o solo al publicar) y Google (cuenta de
-- servicio para leer Analytics 4 y Search Console). Hotjar, Tag Manager y la verificación de Search Console
-- son ids públicos: viven en websites.settings.analytics, no aquí. Idempotente.

alter table public.website_secrets drop constraint if exists website_secrets_provider_check;
alter table public.website_secrets add constraint website_secrets_provider_check
  check (provider in ('github', 'supabase', 'netlify', 'cloudflare', 'google'));
