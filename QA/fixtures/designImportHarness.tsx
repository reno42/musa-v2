import React from "react";
import { createRoot } from "react-dom/client";
import { DesignImportModal } from "../../src/components/DesignImportModal";

const root = document.createElement("div");
document.body.append(root);
(window as any).importedFrames = [];
createRoot(root).render(<DesignImportModal open workspaceId="test-workspace" onClose={() => {}} onImport={results => { (window as any).importedFrames.push(...results); }} />);
