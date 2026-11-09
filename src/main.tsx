import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { AuthProvider } from "./lib/auth";
import { installConsoleCapture } from "./lib/consoleCapture";
// Force vite to bundle GoogleFontPicker (treeshaken by rollup otherwise)
import { GoogleFontPicker } from "./components/GoogleFontPicker";
(window as any).__GoogleFontPicker = GoogleFontPicker;
import "./index.css"
import "./styles/tokens.css";

// Install console error capture for bug reports
installConsoleCapture();

// Un solo editor de diseño: los enlaces /?template=<id> (los que daba editor_open, marcadores viejos,
// correos) abrían el editor anterior de React. Ahora abren el diseño en el editor de la app
// (#crear/disenos/tpl:<id>), el mismo que usan las personas. Video y foto (?view=) siguen igual.
(() => {
  try {
    const p = new URLSearchParams(window.location.search);
    const id = p.get("template");
    if (id && !p.get("view")) window.history.replaceState(null, "", `/#crear/disenos/tpl:${encodeURIComponent(id)}`);
  } catch { /* URL rara: se sigue como antes */ }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider><App /></AuthProvider>
    </ToastProvider>
  </StrictMode>
);
