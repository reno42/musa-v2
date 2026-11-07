import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Modo agencia (migración 23 + api/routes/team.ts): la prueba de estructura.
 * Corre sin base de datos — valida que la migración declare las tablas,
 * columnas y políticas correctas, y que el API exija el acceso en código
 * (el service-role bypasea RLS, así que cada handler debe re-chequearlo).
 * La prueba de comportamiento en vivo vive en db/tests/23_agencia_privacidad.test.sql
 * (correrla en el SQL editor de la DB de pruebas).
 */

const sql = readFileSync(new URL("../db/migrations-v2/23_v2_agencia_privacidad.sql", import.meta.url), "utf8");
const teamTs = readFileSync(new URL("../api/src/routes/team.ts", import.meta.url), "utf8");
const indexTs = readFileSync(new URL("../api/src/index.ts", import.meta.url), "utf8");

test("migración 23 crea invitados, portal y comentarios de contenido", () => {
  assert.match(sql, /create table if not exists public\.brand_guests/i);
  assert.match(sql, /create table if not exists public\.brand_portal/i);
  assert.match(sql, /create table if not exists public\.content_comments/i);
  // Un cliente = una fila por (workspace, marca, email): re-invitar no duplica.
  assert.match(sql, /create unique index if not exists brand_guests_ws_brand_email/i);
  // El comentario es corto por diseño (1..500, igual que design_comments).
  assert.match(sql, /char_length\(body\) between 1 and 500/i);
  // Roles de autor válidos: miembro del equipo, cliente invitado o sistema.
  assert.match(sql, /author_role in \('member','client','system'\)/i);
});

test("migración 23 agrega visibility/tags/created_by a todo el contenido tipo archivo", () => {
  for (const table of [
    "templates", "content_calendar", "briefs", "workspace_events", "workspace_mailings",
    "workspace_forms", "workspace_clones", "workspace_projects", "workspace_playbooks",
    "workspace_agents", "flows", "musa_video_projects", "workspace_take_scripts", "brain_notes",
  ]) {
    assert.ok(
      sql.includes(`'${table}'`),
      `la tabla ${table} falta en la lista de visibility/tags/created_by`,
    );
  }
  assert.match(sql, /add column if not exists visibility text not null default/i);
  assert.match(sql, /add column if not exists tags text\[\] not null default/i);
  assert.match(sql, /add column if not exists created_by uuid/i);
  // brand_id explícito donde la marca no existía como columna (invitados).
  assert.match(sql, /'workspace_clones','flows','musa_video_projects','workspace_take_scripts'/);
  assert.match(sql, /add column if not exists brand_id text/i);
});

test("migración 23 marca el negocio propio (is_house) para filtros «Mi negocio»", () => {
  assert.match(sql, /alter table public\.brands add column if not exists is_house boolean not null default false/i);
});

test("migración 23: capa restrictive privado/compartido + escape del servidor confiable", () => {
  // Privado = solo quien lo creó, un admin o el servidor (trabajos internos).
  // created_by::text: la columna puede ser uuid (agregada aquí) o text (ya existía, p. ej. flows).
  assert.match(sql, /as restrictive for select to public using \(\s*coalesce\(visibility, 'shared'\) = 'shared'\s*or created_by::text = auth\.uid\(\)::text/i);
  assert.match(sql, /or has_workspace_role\(workspace_id, 'admin'\)/i);
  // El patrón musa.trusted del repo para trabajos del service worker.
  assert.match(sql, /coalesce\(current_setting\('musa\.trusted', true\), ''\) = '1'/i);
  // Las tablas v1 sin RLS se encienden con acceso de equipo equivalente (no se rompe la v1).
  assert.match(sql, /for select to public using \(has_workspace_role\(workspace_id, %L\)\)', t \|\| '_ag_read', t, 'viewer'\)/i);
  assert.match(sql, /_ag_write[\s\S]*?has_workspace_role\(workspace_id, %L\)\) with check \(has_workspace_role\(workspace_id, %L\)\)', t \|\| '_ag_write'/i);
});

test("migración 23: invitados solo lo compartido de SU marca", () => {
  assert.match(sql, /create or replace function public\.musa_guest_brand_ids/i);
  // status activo: revocado deja de ver aunque la fila sobreviva.
  assert.match(sql, /status = 'activo'/i);
  // Política por tabla con expresión de marca (jsonb incluido) + cerebro especial.
  assert.match(sql, /_ag_guest_read[\s\S]*?musa_guest_brand_ids\(auth\.uid\(\), workspace_id\)/i);
  assert.match(sql, /brain_notes_ag_guest_read[\s\S]*?entity_type = 'brand'/i);
  // Solo lo compartido: la restrictive también aplica al invitado.
  assert.match(sql, /coalesce\(visibility, 'shared'\) = 'shared'\s+and %s is not null/i);
});

test("team API: el acceso se resuelve como miembro o como invitado, nunca por omisión", () => {
  assert.match(teamTs, /kind: "member"; role: WorkspaceRole/);
  assert.match(teamTs, /kind: "guest"; brandIds: string\[\]/);
  assert.match(teamTs, /kind: "none"/);
  // Lazy link: la invitación se creó por email antes de que existiera la cuenta.
  assert.match(teamTs, /update\(\{ user_id: auth\.userId \}\)/);
});

test("team API: invitado solo ve entidades compartidas de su marca (espejo del SQL)", () => {
  // La comprobación de visibilidad: shared Y marca propia.
  assert.match(teamTs, /visibility === "shared" && Boolean\(brand\) && access\.brandIds\.includes\(brand!\)/);
  // templates guarda la marca en data->>brandId, mailings en content->>brand_id.
  assert.match(teamTs, /templates: \{ table: "templates", col: "data", json: "brandId" \}/);
  assert.match(teamTs, /workspace_mailings: \{ table: "workspace_mailings", col: "content", json: "brand_id" \}/);
  // Tablas sin mapa NO son visibles para invitados (conservador, igual que RLS).
  assert.match(teamTs, /if \(!def\) return \{ brand: null, visibility: "private" \}/);
});

test("team API: invitados y administración quedan tras gates explícitos", () => {
  // Invitar/revocar es de admins; listar de viewers.
  assert.match(teamTs, /Solo un admin puede invitar clientes/);
  assert.match(teamTs, /Solo un admin puede revocar clientes/);
  assert.match(teamTs, /hasMinimumWorkspaceRole\(access\.role, "admin"\)/);
  // El comentario del cliente solo en entidades de su marca, author_role client.
  assert.match(teamTs, /author_role: access\.kind === "guest" \? "client" : "member"/);
  // Resolver comentarios: autor o admin.
  assert.match(teamTs, /Solo el autor o un admin puede resolver/);
});

test("index.ts monta equipo, portal y comentarios con sesión de usuario", () => {
  assert.match(indexTs, /import \{ teamRoutes, portalRoutes, contentCommentRoutes \} from "\.\/routes\/team\.js";/);
  assert.match(indexTs, /app\.use\("\/api\/team", requireUserSession, teamRoutes\)/);
  assert.match(indexTs, /app\.use\("\/api\/brand-portal", requireUserSession, portalRoutes\)/);
  assert.match(indexTs, /app\.use\("\/api\/comments", requireUserSession, contentCommentRoutes\)/);
});
