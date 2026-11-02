-- Segundo cerebro: las notas propias (source = 'human') se editan y se borran desde la UI y por agentes;
-- las del sistema (generadas por Musa) quedan de solo lectura para el navegador. Idempotente.
begin;
grant insert, update, delete on public.brain_notes to authenticated;
drop policy if exists brain_notes_human_update on public.brain_notes;
create policy brain_notes_human_update on public.brain_notes as restrictive for update to authenticated using (source = 'human') with check (source = 'human');
drop policy if exists brain_notes_human_delete on public.brain_notes;
create policy brain_notes_human_delete on public.brain_notes as restrictive for delete to authenticated using (source = 'human');
create index if not exists idx_brain_notes_ws_updated on public.brain_notes (workspace_id, updated_at desc);
commit;
