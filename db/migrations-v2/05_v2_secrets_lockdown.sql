-- Las llaves y credenciales solo las ve el servidor (service_role). Ningún usuario —ni siquiera
-- otro miembro del mismo espacio— puede leer columnas con secretos, y anon no toca estas tablas.
do $$ declare t text; begin
  foreach t in array array['user_api_keys','user_provider_keys','workspace_api_keys','flow_credentials','workspace_mcp_connections','oauth_clients','oauth_codes','workspace_config','api_keys'] loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- llaves BYOK por usuario: el usuario ve proveedor/modelo/últimos 4, nunca el cifrado
revoke select, insert, update on public.user_api_keys from authenticated;
grant select (id, user_id, provider, model, last4, created_at, updated_at) on public.user_api_keys to authenticated;
revoke all on public.user_provider_keys from authenticated;
-- conexiones del espacio: todo menos las credenciales
revoke select, insert, update on public.workspace_mcp_connections from authenticated;
grant select (id, workspace_id, name, kind, provider, endpoint_url, enabled, public_config, created_by, created_at, updated_at) on public.workspace_mcp_connections to authenticated;
-- credenciales de flows: todo menos secretos y tokens OAuth
revoke select, insert, update on public.flow_credentials from authenticated;
grant select (id, workspace_id, name, type, provider, model, header_name, username, last4, created_by, created_at, updated_at) on public.flow_credentials to authenticated;
-- claves de API del espacio y OAuth: solo servidor
revoke all on public.workspace_api_keys, public.oauth_clients, public.oauth_codes, public.api_keys from authenticated;
notify pgrst, 'reload schema';
revoke truncate, trigger, references on public.user_api_keys, public.workspace_mcp_connections, public.flow_credentials from authenticated;
