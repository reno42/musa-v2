import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { AuthProvider } from "./lib/auth";
import { BugReportButton } from "./components/BugReportButton";
import { installConsoleCapture } from "./lib/consoleCapture";
// Force vite to bundle GoogleFontPicker (treeshaken by rollup otherwise)
import { GoogleFontPicker } from "./components/GoogleFontPicker";
(window as any).__GoogleFontPicker = GoogleFontPicker;
import "./index.css";

// Install console error capture for bug reports
installConsoleCapture();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider><App /></AuthProvider>
    </ToastProvider>
    <BugReportButton />
  </StrictMode>
);
