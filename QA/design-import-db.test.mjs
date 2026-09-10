import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("v46 applies twice; commits preserve frames and reject cross-workspace writes", { timeout: 60000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE TABLE auth.users(id UUID PRIMARY KEY);
      CREATE TABLE workspaces(id TEXT PRIMARY KEY);
      CREATE TABLE templates(id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id), data JSONB, deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, content_updated_at TIMESTAMPTZ);
      CREATE TABLE workspace_mcp_connections(id TEXT PRIMARY KEY, workspace_id TEXT, provider TEXT);
      CREATE TABLE storage.buckets(id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT, allowed_mime_types TEXT[]);
      CREATE TABLE storage.objects(id UUID PRIMARY KEY, bucket_id TEXT, name TEXT);
      CREATE FUNCTION has_workspace_role(TEXT, TEXT) RETURNS BOOLEAN LANGUAGE SQL AS 'SELECT true';
      CREATE FUNCTION storage.foldername(TEXT) RETURNS TEXT[] LANGUAGE SQL AS 'SELECT string_to_array($1, ''/'')';
    `);
    // PGlite has gen_random_uuid built in; pgcrypto itself is a Supabase extension.
    const migration = (await readFile(new URL("../supabase_migrations_v46.sql", import.meta.url), "utf8")).replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`INSERT INTO workspaces VALUES ('a'),('b'); INSERT INTO templates VALUES ('ta','a','{"frames":[{"id":"existing"}]}',NULL,NULL,NULL),('tb','b','{"frames":[]}',NULL,NULL,NULL);`);
    const create = async key => (await db.query(`INSERT INTO design_import_jobs(workspace_id,idempotency_key,source_type,source_name,status) VALUES ('a',$1,'svg','test','ready') RETURNING id`, [key])).rows[0].id;
    const first = await create("first");
    const second = await create("second");
    const commit = (id, workspace, template, frames) => db.query("SELECT commit_design_import($1,$2,$3,$4) AS result", [id, workspace, template, JSON.stringify(frames)]);
    await Promise.all([commit(first, "a", "ta", [{ id: "first", html: "<svg/>" }]), commit(second, "a", "ta", [{ id: "second", html: "<svg/>" }])]);
    const replay = await commit(first, "a", "ta", [{ id: "unwanted" }]);
    assert.deepEqual(replay.rows[0].result.frameIds, ["first"]);
    const frames = (await db.query("SELECT data->'frames' AS frames FROM templates WHERE id='ta'")).rows[0].frames;
    assert.deepEqual(frames.map(frame => frame.id), ["existing", "first", "second"]);
    const third = await create("third");
    await assert.rejects(commit(third, "a", "tb", [{ id: "bad" }]), /Template not found/);
    await assert.rejects(commit(third, "b", "tb", [{ id: "bad" }]), /Import job not found/);
    assert.equal((await db.query("SELECT status FROM design_import_jobs WHERE id=$1", [third])).rows[0].status, "ready");
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.query("UPDATE design_import_jobs SET result='{}'"), /permission denied/);
    await assert.rejects(commit(third, "a", "ta", [{ id: "bad" }]), /permission denied/);
  } finally { await db.close(); }
});
