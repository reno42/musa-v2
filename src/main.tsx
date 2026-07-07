import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
// Force vite to bundle GoogleFontPicker (treeshaken by rollup otherwise)
import { GoogleFontPicker } from "./components/GoogleFontPicker";
(window as any).__GoogleFontPicker = GoogleFontPicker;
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
