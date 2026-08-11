import React, { useState, useEffect, useRef, useCallback } from "react";
import type { SelectedElementInfo } from "./DesignFrame";
import { GoogleFontPicker } from "./GoogleFontPicker";
import {
  IconAlignLeft, IconAlignCenter, IconAlignRight,
  IconType, IconX,
} from "../shared/icons";

const COMMON_FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72];

interface Props {
  x: number;
  y: number;
  selectedElement: SelectedElementInfo | null;
  foregroundColor: string;
  onClose: () => void;
  onFontChange: (fontFamily: string) => void;
  onFontSizeChange: (fontSize: string) => void;
  onTextColorChange: (color: string) => void;
  onTextAlignChange: (align: string) => void;
}

export function CanvasContextMenu({
  x, y,
  selectedElement,
  foregroundColor,
  onClose,
  onFontChange,
  onFontSizeChange,
  onTextColorChange,
  onTextAlignChange,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [localFontSize, setLocalFontSize] = useState("");
  const [localColor, setLocalColor] = useState(foregroundColor);

  const isTextElement = selectedElement?.tag?.toLowerCase() === "div"
    || selectedElement?.layerKind === "text"
    || selectedElement?.computedStyles?.["font-family"];

  const currentFontFamily = selectedElement?.computedStyles?.["font-family"]?.replace(/['"]/g, "") || "";
  const currentFontSize = selectedElement?.computedStyles?.["font-size"] || "";
  const currentTextAlign = selectedElement?.computedStyles?.["text-align"] || "left";
  const currentColor = selectedElement?.computedStyles?.color || "#000000";

  // Initialize local state from element
  useEffect(() => {
    setLocalFontSize(currentFontSize.replace("px", ""));
    setLocalColor(currentColor);
  }, [currentFontSize, currentColor]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        // Small delay to allow sub-menu clicks (font picker)
        setTimeout(() => onClose(), 50);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleFontSizeApply = useCallback(() => {
    const num = parseFloat(localFontSize);
    if (!isNaN(num) && num > 0) {
      onFontSizeChange(`${num}px`);
    }
  }, [localFontSize, onFontSizeChange]);

  const handleColorApply = useCallback(() => {
    onTextColorChange(localColor);
  }, [localColor, onTextColorChange]);

  // Adjust position to keep menu within viewport
  const adjustedX = Math.min(x, window.innerWidth - 260);
  const adjustedY = Math.min(y, window.innerHeight - (isTextElement ? 340 : 120));

  if (!selectedElement) {
    // Generic context menu for non-text elements
    return (
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          left: adjustedX,
          top: adjustedY,
          zIndex: 1000,
          minWidth: 180,
          background: "var(--glass-bg, rgba(12,12,12,0.92))",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
          borderRadius: 10,
          padding: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          fontSize: 12,
          color: "var(--text-main, #c4c0b4)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 4,
        }}>
          <span style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>
            Element
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#7a7668", padding: 2,
            }}
          >
            <IconX size={12} />
          </button>
        </div>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "#7a7668" }}>
          Select a text element to see font options.
        </div>
      </div>
    );
  }

  if (!isTextElement) {
    // Non-text element selected
    return (
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          left: adjustedX,
          top: adjustedY,
          zIndex: 1000,
          minWidth: 180,
          background: "var(--glass-bg, rgba(12,12,12,0.92))",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
          borderRadius: 10,
          padding: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          fontSize: 12,
          color: "var(--text-main, #c4c0b4)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          marginBottom: 4,
        }}>
          <span style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1 }}>
            {selectedElement!.tag} {selectedElement!.layerKind ? `· ${selectedElement!.layerKind}` : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#7a7668", padding: 2,
            }}
          >
            <IconX size={12} />
          </button>
        </div>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "#7a7668" }}>
          Text tools only available for text elements.
        </div>
      </div>
    );
  }

  // Text element context menu
  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: adjustedX,
        top: adjustedY,
        zIndex: 1000,
        minWidth: 240,
        background: "var(--glass-bg, rgba(12,12,12,0.92))",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
        borderRadius: 10,
        padding: 6,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        fontSize: 12,
        color: "var(--text-main, #c4c0b4)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <IconType size={12} />
          <span style={{ fontSize: 11, fontWeight: 600 }}>Text</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "#7a7668", padding: 2,
          }}
        >
          <IconX size={12} />
        </button>
      </div>

      {/* Font Family */}
      <div style={{ padding: "0 4px", marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
          Font Family
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setShowFontPicker(v => !v)}
            style={{
              width: "100%", padding: "5px 8px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6, color: "#f0ebe0",
              fontSize: 11, fontFamily: "inherit",
              cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}
          >
            <span style={{
              fontFamily: currentFontFamily || "inherit",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {currentFontFamily || "Select font..."}
            </span>
            <span style={{ fontSize: 9, color: "#7a7668", marginLeft: 8 }}>▼</span>
          </button>
          {showFontPicker && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 999 }}
                onClick={() => setShowFontPicker(false)}
              />
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0,
                marginTop: 4, zIndex: 1001,
                maxHeight: 240, overflow: "auto",
                background: "var(--glass-bg, rgba(12,12,12,0.95))",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
                borderRadius: 8,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}>
                <GoogleFontPicker
                  value={currentFontFamily}
                  onChange={(font) => {
                    onFontChange(font);
                    setShowFontPicker(false);
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Font Size */}
      <div style={{ padding: "0 4px", marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
          Font Size
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="number"
            value={localFontSize}
            onChange={e => setLocalFontSize(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleFontSizeApply(); }}
            onBlur={handleFontSizeApply}
            min={1}
            max={512}
            step={1}
            style={{
              flex: 1, minWidth: 0,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6, color: "#f0ebe0",
              fontSize: 11, fontFamily: "SF Mono, monospace",
              padding: "5px 8px", outline: "none",
            }}
            placeholder="Size"
          />
          <span style={{ fontSize: 10, color: "#7a7668", flexShrink: 0 }}>px</span>
        </div>
        {/* Quick size presets */}
        <div style={{ display: "flex", gap: 2, marginTop: 4, flexWrap: "wrap" }}>
          {COMMON_FONT_SIZES.slice(0, 8).map(size => (
            <button
              key={size}
              type="button"
              onClick={() => {
                setLocalFontSize(String(size));
                onFontSizeChange(`${size}px`);
              }}
              style={{
                padding: "1px 5px",
                background: currentFontSize === `${size}px` ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
                border: currentFontSize === `${size}px` ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
                borderRadius: 4, color: currentFontSize === `${size}px` ? "#c8b898" : "#7a7668",
                fontSize: 9, fontFamily: "SF Mono, monospace",
                cursor: "pointer",
              }}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Text Color */}
      <div style={{ padding: "0 4px", marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
          Text Color
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="color"
            value={localColor.startsWith("#") ? localColor : "#000000"}
            onChange={e => {
              setLocalColor(e.target.value);
              onTextColorChange(e.target.value);
            }}
            style={{
              width: 28, height: 28,
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4, cursor: "pointer", padding: 0,
              background: "none", flexShrink: 0,
            }}
          />
          <input
            type="text"
            value={localColor}
            onChange={e => setLocalColor(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleColorApply(); }}
            onBlur={handleColorApply}
            style={{
              flex: 1, minWidth: 0,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6, color: "#f0ebe0",
              fontSize: 11, fontFamily: "SF Mono, monospace",
              padding: "5px 8px", outline: "none",
            }}
            placeholder="#000000"
          />
        </div>
      </div>

      {/* Text Alignment */}
      <div style={{ padding: "0 4px", marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: "#7a7668", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
          Alignment
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {([
            { value: "left", icon: <IconAlignLeft size={14} />, label: "Left" },
            { value: "center", icon: <IconAlignCenter size={14} />, label: "Center" },
            { value: "right", icon: <IconAlignRight size={14} />, label: "Right" },
          ] as const).map(({ value, icon, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onTextAlignChange(value)}
              title={label}
              style={{
                flex: 1,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "5px 0",
                background: currentTextAlign === value ? "var(--accent-dim, rgba(200,184,152,0.15))" : "transparent",
                border: currentTextAlign === value ? "1px solid var(--accent, #c8b898)" : "1px solid transparent",
                borderRadius: 6, color: currentTextAlign === value ? "#c8b898" : "#7a7668",
                cursor: "pointer",
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
