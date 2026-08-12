# `shared/` — the design rules, written once

What a layer **is**, and what it can be **painted with**. These are the rules of
the harness itself, so every surface has to agree on them: the editor a person
clicks in, the MCP tools an agent drives, and anything added later.

They used to live twice — once under `src/` for the browser and once under
`api/` for the server — because each package's TypeScript config was sealed to
its own folder. Two copies of a rule is how the editor and an agent end up
disagreeing about what "fill" means, silently. That is the same shape as the
align bug, where the editor sent `alignment` and the server read `align`.

## What is here

| file | answers |
|---|---|
| `paintModel.ts` | Which CSS property paints this layer — `background-color` on a div, `fill` on a path, `color` on a glyph, nothing on a group |
| `paintDetection.ts` | Whether a given block of CSS paints a visible box at all |

## Rules for this folder

**Keep it dependency-free.** Plain TypeScript, no React, no Express, no
Supabase, no DOM. It is imported by a browser bundle, a Node server and an
esbuild-packaged function; anything one of them cannot load breaks a deploy.

**Keep it pure.** Functions in, values out. No I/O, no globals. That is what
lets `QA/` cover it directly.

## Import it with the `.ts` extension

```ts
import { paintsABox } from "../../shared/paintDetection.ts";
```

Not a style preference — it is the one specifier all **four** consumers
resolve. The rest of `api/` imports its neighbours as `.js`, which the bundler
rewrites to `.ts`; node's test runner does not do that rewrite, so a QA test
that reaches this folder through an api file would fail to even load. An
explicit `.ts` is understood by every one of them.

## How each side reaches it

Four toolchains have to know this folder exists. If you add a file here and one
of them is not looking, it works locally and fails when published.

| consumer | how it finds `shared/` | what proves it |
|---|---|---|
| The editor | `tsconfig.json` lists `shared` in `include` | `npx tsc --noEmit` |
| The server | `api/tsconfig.json` lists `../shared`, with `allowImportingTsExtensions` | `npm run build:functions` |
| The Netlify functions | esbuild follows the relative import from source | bundling `netlify/functions/*.mjs` |
| `QA/` | node's `--experimental-strip-types` reads the `.ts` directly | `npm run test:regression` |

Both `tsc` invocations run with `--noEmit`, because neither package's compiled
output is deployed — the editor ships through Vite and the functions through
esbuild. They are type gates, so nothing downstream depends on where their
files would have landed.
