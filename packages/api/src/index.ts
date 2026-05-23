// packages/api/src/index.ts
// Standalone server entry point.
// App configuration lives in app.ts (imported by Netlify functions too).

import { app } from "./app";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 Futuraria Design API v3.0 on http://${HOST}:${PORT}`);
  console.log(`   Auth: ${process.env.SUPABASE_URL ? "Supabase" : "disabled (dev mode)"}`);
  console.log(`   Routes: /api/templates, /api/webhooks, /api/styles, /api/components, /api/comments, /api/variables`);
});
