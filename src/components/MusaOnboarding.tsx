/**
 * MusaOnboarding — scripted first-run conversation with Musa.
 *
 * When a new user signs in for the first time (onboarding_completed = false),
 * this overlay dims the whole screen and opens a right-side chat panel that
 * looks identical to ChatFAB but runs a scripted flow instead of calling an
 * LLM:
 *
 *   1. Musa greets → asks the user's name
 *   2. Musa asks if they have a brand / consultancy name
 *   3. If no brand → uses the user's name as the brand name
 *   4. Offers to start the product tour
 *   5. Marks onboarding_completed = true
 *
 * All data is saved via PATCH /account/me (profile fields + onboarding flag).
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "../lib/supabase";

interface MusaMessage {
  role: "user" | "assistant";
  content: string;
}

type Step = "greeting" | "ask-name" | "ask-brand" | "confirm-default-brand" | "offer-tour" | "done";

interface Props {
  /** Called when onboarding finishes (user completed or skipped). */
  onComplete: (startTour: boolean) => void;
}

export function MusaOnboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("greeting");
  const [messages, setMessages] = useState<MusaMessage[]>([
    {
      role: "assistant",
      content:
        "Hola! Soy Musa, tu co-pilot de diseño. Voy a estar con vos mientras creas tus diseños. Primero, ¿cómo te llamas?",
    },
  ]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [userName, setUserName] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, step]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [step]);

  const addAssistant = useCallback((content: string) => {
    setMessages(prev => [...prev, { role: "assistant", content }]);
  }, []);

  const addUser = useCallback((content: string) => {
    setMessages(prev => [...prev, { role: "user", content }]);
  }, []);

  const saveProfile = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      await apiFetch("/account/me", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    } catch { /* best-effort — onboarding continues even if save fails */ }
    setSaving(false);
  }, []);

  const finish = useCallback(
    async (startTour: boolean) => {
      await saveProfile({ onboarding_completed: true });
      onComplete(startTour);
    },
    [saveProfile, onComplete],
  );

  const handleName = async () => {
    const name = input.trim();
    if (!name) return;
    addUser(name);
    setUserName(name);
    setInput("");
    await saveProfile({ first_name: name, display_name: name });
    addAssistant(
      `Encantada, ${name}! ¿Tienes una marca personal, agencia o consultora? Si no tenés una, no pasa nada — puedo usar tu nombre.`,
    );
    setStep("ask-brand");
  };

  const handleBrand = async () => {
    const brand = input.trim();
    if (!brand) return;
    addUser(brand);
    setInput("");
    await saveProfile({ brand_name: brand });
    addAssistant(`Perfecto, "${brand}" queda configurada como tu marca. Ya la vas a ver en el CRM y en tus diseños.`);
    setStep("offer-tour");
  };

  const handleNoBrand = async () => {
    const defaultBrand = userName || "Mi marca";
    addUser("(no tengo marca)");
    setInput("");
    await saveProfile({ brand_name: defaultBrand });
    addAssistant(`Genial! Voy a usar "${defaultBrand}" como tu nombre de marca. Podés cambiarlo cuando quieras desde Configuración.`);
    setStep("offer-tour");
  };

  const handleSubmit = () => {
    if (saving) return;
    if (step === "ask-name") void handleName();
    else if (step === "ask-brand") void handleBrand();
  };

  const panelWidth = 420;

  return createPortal(
    <>
      {/* Dim overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(4, 4, 14, 0.78)",
          zIndex: 9040,
          pointerEvents: "auto",
          transition: "background 0.35s ease",
        }}
      />

      {/* Right-side chat panel — styled identically to ChatFAB */}
      <div
        data-chat-fab-panel="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 9050,
          width: panelWidth,
          background: "rgba(10,10,15,0.97)",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(16px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-10px 0 40px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            M
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)", flex: 1 }}>
            Musa · Onboarding
          </span>
          <button
            type="button"
            onClick={() => void finish(false)}
            title="Saltar onboarding"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: 16,
              borderRadius: 8,
              padding: "4px 10px",
              fontFamily: "inherit",
            }}
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                background:
                  m.role === "user" ? "rgba(200,184,152,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${
                  m.role === "user" ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.06)"
                }`,
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.85)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.content}
            </div>
          ))}

          {/* Quick action buttons for "no brand" */}
          {step === "ask-brand" && (
            <div style={{ alignSelf: "flex-start", maxWidth: "85%" }}>
              <button
                type="button"
                onClick={() => void handleNoBrand()}
                disabled={saving}
                style={{
                  background: "rgba(139,92,246,0.15)",
                  color: "#c4b5fd",
                  border: "1px solid rgba(139,92,246,0.3)",
                  borderRadius: 100,
                  padding: "6px 16px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginTop: 4,
                }}
              >
                No tengo marca
              </button>
            </div>
          )}

          {/* Tour offer buttons */}
          {step === "offer-tour" && (
            <div
              style={{
                alignSelf: "flex-start",
                maxWidth: "85%",
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 4,
              }}
            >
              <button
                type="button"
                onClick={() => void finish(true)}
                disabled={saving}
                style={{
                  background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 100,
                  padding: "8px 18px",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Sí, muéstrame cómo funciona →
              </button>
              <button
                type="button"
                onClick={() => void finish(false)}
                disabled={saving}
                style={{
                  background: "transparent",
                  color: "rgba(255,255,255,0.5)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 100,
                  padding: "8px 18px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Ya puedo empezar solo
              </button>
            </div>
          )}

          {saving && (
            <div style={{ alignSelf: "flex-start", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              Guardando…
            </div>
          )}
        </div>

        {/* Input */}
        {(step === "ask-name" || step === "ask-brand") && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder={step === "ask-name" ? "Tu nombre…" : "Nombre de tu marca…"}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  fontSize: 12.5,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.9)",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!input.trim() || saving}
                style={{
                  background: input.trim() ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.04)",
                  color: input.trim() ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
