import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** Valores del diálogo numérico: caja en px del contenido + rotación en grados. */
export interface NumericTransformValues {
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
}

interface NumericTransformDialogProps {
  initial: NumericTransformValues;
  onApply: (values: NumericTransformValues) => void;
  onCancel: () => void;
}

/**
 * REQ-045: diálogo numérico de transformación (Enter con select/hand y una
 * capa activa). X/Y/W/H/Ángulo editables a mano; Enter aplica, Esc cancela.
 * El listener va en captura con stopPropagation para que el teclado no
 * escape al editor mientras el diálogo está abierto.
 */
export function NumericTransformDialog({ initial, onApply, onCancel }: NumericTransformDialogProps) {
  const [values, setValues] = useState<NumericTransformValues>(initial);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    firstFieldRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        onApply(values);
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [values, onApply, onCancel]);

  const fields: { key: keyof NumericTransformValues; label: string }[] = [
    { key: "x", label: "X" },
    { key: "y", label: "Y" },
    { key: "width", label: "W" },
    { key: "height", label: "H" },
    { key: "rotate", label: "Ángulo" },
  ];

  const inputStyle: CSSProperties = {
    width: "100%", background: "#111827", border: "1px solid #374151",
    borderRadius: 6, color: "#E5E7EB", padding: "4px 6px", fontSize: 12,
  };

  return createPortal(
    <div
      data-numeric-transform=""
      onMouseDown={event => event.stopPropagation()}
      style={{
        position: "fixed", top: 96, left: "50%", transform: "translateX(-50%)",
        zIndex: 10000, width: 264, background: "#1F2937", border: "1px solid #374151",
        borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.45)", padding: 12,
        color: "#E5E7EB", fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 12, letterSpacing: 0.2 }}>Transformar</strong>
        <button
          type="button" onClick={onCancel} title="Cerrar (Esc)"
          style={{ background: "transparent", border: "none", color: "#9CA3AF", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
        >×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {fields.map((field, index) => (
          <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#9CA3AF" }}>
            {field.label}
            <input
              ref={index === 0 ? firstFieldRef : undefined}
              type="number"
              step="any"
              value={values[field.key]}
              onChange={event => {
                const next = Number.parseFloat(event.target.value);
                setValues(current => ({ ...current, [field.key]: Number.isFinite(next) ? next : 0 }));
              }}
              style={inputStyle}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button
          type="button" onClick={onCancel}
          style={{ flex: 1, background: "#374151", border: "1px solid #4B5563", borderRadius: 6, color: "#E5E7EB", padding: "5px 0", fontSize: 12, cursor: "pointer" }}
        >Cancelar (Esc)</button>
        <button
          type="button" onClick={() => onApply(values)}
          style={{ flex: 1, background: "#3B82F6", border: "1px solid #2563EB", borderRadius: 6, color: "#fff", padding: "5px 0", fontSize: 12, cursor: "pointer" }}
        >Aplicar (Enter)</button>
      </div>
    </div>,
    document.body,
  );
}
