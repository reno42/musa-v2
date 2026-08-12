/**
 * Checks the group-paint invariant against a RUNNING API.
 *
 * The unit tests cover the rule itself; this covers the wiring — that it is
 * really applied on the way through `updateTemplate`, which is the single
 * chokepoint every one of the eighty-odd template writers passes through.
 * It cannot be a node test: templates.ts imports `./store.js`, and resolving
 * that to a .ts file is a bundler feature node does not have.
 *
 *   cd api && npm run dev        # :3001
 *   node debug/group-paint-live.mjs
 */
const API = process.argv[2] || "http://localhost:3001";
const KEY = process.argv[3] || "dev-key";

const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

const workspaces = await call("GET", "/api/workspaces");
const workspaceId = (workspaces.data || workspaces)[0]?.id
  || (await call("POST", "/api/workspaces", { name: "group-paint probe" })).data.id;

const created = await call("POST", "/api/templates", {
  workspaceId, name: `group-paint probe ${Date.now()}`, engine: "html", frames: [], html: "", css: "",
});
const id = created.data?.id || created.id;
console.log("template", id);

const saved = await call("PUT", `/api/templates/${id}`, {
  frames: [
    {
      id: "f1", name: "Painted", width: 1080, height: 1080,
      html: '<div data-layer-id="grp" data-layer-kind="group"><p data-layer-id="t">Hi</p></div>',
      css: '[data-layer-id="grp"] { background-color: #101010; padding: 24px; }',
    },
    {
      id: "f2", name: "Clean", width: 1080, height: 1080,
      html: '<div data-layer-id="g2" data-layer-kind="group"><p data-layer-id="u">Hi</p></div>',
      css: '[data-layer-id="g2"] { position: absolute; }',
    },
  ],
});

const frames = (saved.data || saved).frames;
const kindOf = frame => /data-layer-kind="(\w+)"/.exec(frame.html)?.[1];
const [painted, clean] = frames;

console.log(`painted group  -> ${kindOf(painted)}   (expected container)`);
console.log(`  paint kept     ${painted.css.includes("#101010")}`);
console.log(`  child intact   ${painted.html.includes('data-layer-id="t"')}`);
console.log(`clean group    -> ${kindOf(clean)}       (expected group)`);

const ok = kindOf(painted) === "container"
  && painted.css.includes("#101010")
  && painted.html.includes('data-layer-id="t"')
  && kindOf(clean) === "group";

await call("DELETE", `/api/templates/${id}`).then(
  () => console.log("cleanup: probe template deleted"),
  e => console.log("cleanup FAILED, delete manually:", id, e.message),
);
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
