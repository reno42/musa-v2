// Side-effect import: fills missing process.env from .env files BEFORE any
// module reads env at module scope (see loadEnvFiles.ts header).
import "./loadEnvFiles.js";
import app from "./index.js";
const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`🚀 Futuraria API running at http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
