/**
 * REQ-082 — IntranetClient: vista de CLIENTE FINAL (login email+PIN).
 *
 * NO es la app de Musa: es la vista mínima dentro de musaworks.com donde el
 * cliente del operador zero-person ve SOLO su marca: piezas de la semana,
 * aprobar/rechazar pendientes y el inbox de su marca. Sin usuarios Supabase:
 * token efímero del login /api/inbox/clients/login, todo scopeado por brandId
 * del token en el backend (el cliente jamás elige su brandId).
 *
 * MCP-first para el agente: las mismas lecturas existen como tools
 * (calendar/cards/inbox de la marca).
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";

type Piece = { id: string; name: string; status: string; scheduledDate?: string; thumb?: string | null };

export function IntranetClientApp({ workspaceId }: { workspaceId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // si volvió de un login previo en esta sesión
  useEffect(() => {
    const saved = sessionStorage.getItem("intranet_client_token");
    const savedBrand = sessionStorage.getItem("intranet_client_brand");
    if (saved && savedBrand) { setToken(saved); setBrandId(savedBrand); setName(sessionStorage.getItem("intranet_client_name") || ""); }
  }, []);

  const loadPieces = useCallback(async (t: string, b: string) => {
    setLoading(true);
    setError(null);
    try {
      // Vista de marca: usa el endpoint de operaciones con el token de cliente via header custom.
      const res = await apiFetch<{ brands?: Array<{ brandId: string; name: string; pendingApproval: number }> }>(
        `/api/operations/overview?workspaceId=${encodeURIComponent(workspaceId)}&clientToken=${encodeURIComponent(t)}`,
        { headers: { "x-client-token": t } },
      );
      const mine = (res.brands || []).find((x) => x.brandId === b);
      if (mine) setNotice(`${mine.pendingApproval} piezas esperando tu aprobación`);
      // piezas: el calendario de su marca (read-only scoping hecho por el backend con el token)
      const cal = await apiFetch<{ items?: Piece[] }>(
        `/api/inbox/client-pieces?workspaceId=${encodeURIComponent(workspaceId)}&brandId=${encodeURIComponent(b)}`,
        { headers: { "x-client-token": t } },
      );
      setPieces(cal.items || []);
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar tu información");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{ token: string; brandId: string; name?: string }>("/api/inbox/clients/login", {
        method: "POST",
        body: JSON.stringify({ workspaceId, email, pin }),
      });
      setToken(res.token); setBrandId(res.brandId); setName(res.name || "");
      sessionStorage.setItem("intranet_client_token", res.token);
      sessionStorage.setItem("intranet_client_brand", res.brandId);
      sessionStorage.setItem("intranet_client_name", res.name || "");
      loadPieces(res.token, res.brandId);
    } catch (e: any) {
      setError(e?.message || "Credenciales inválidas");
    }
  };

  if (!token || !brandId) {
    return (
      <div style={{ maxWidth: 380, margin: "60px auto", display: "grid", gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Intranet de clientes</h2>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>Entra con las credenciales que te compartió tu agencia. Ves únicamente el contenido de tu marca.</p>
        <form onSubmit={login} style={{ display: "grid", gap: 10 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" type="email" required
            style={{ border: "1px solid rgba(255,255,255,.2)", background: "transparent", borderRadius: 10, padding: "10px 12px", color: "inherit" }} />
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Tu PIN" type="password" required
            style={{ border: "1px solid rgba(255,255,255,.2)", background: "transparent", borderRadius: 10, padding: "10px 12px", color: "inherit" }} />
          {error && <div style={{ border: "1px solid rgba(255,90,0,.4)", borderRadius: 10, padding: "8px 12px", fontSize: 13.5 }}>{error}</div>}
          <button type="submit" style={{ border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.06)", color: "inherit", borderRadius: 999, padding: "10px 18px", cursor: "pointer", fontSize: 14 }}>
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: "40px auto", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{name || "Tu marca"}</h2>
        <button onClick={() => { sessionStorage.clear(); setToken(null); setBrandId(null); }}
          style={{ border: "none", background: "transparent", color: "inherit", opacity: 0.6, cursor: "pointer", fontSize: 13 }}>
          Salir
        </button>
      </div>
      {notice && <div style={{ border: "1px solid rgba(0,184,79,.4)", borderRadius: 10, padding: "8px 12px", fontSize: 13.5 }}>{notice}</div>}
      {loading && <p style={{ opacity: 0.6, fontSize: 14 }}>Cargando…</p>}
      {error && <div style={{ border: "1px solid rgba(255,90,0,.4)", borderRadius: 10, padding: "8px 12px", fontSize: 13.5 }}>{error}</div>}
      <div style={{ display: "grid", gap: 8 }}>
        {pieces.map((p) => (
          <div key={p.id} style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <strong style={{ fontSize: 14.5 }}>{p.name}</strong>
              <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: 2 }}>{p.status}{p.scheduledDate ? ` · ${p.scheduledDate}` : ""}</div>
            </div>
            {p.status === "aprobación" && (
              <div style={{ display: "grid", gap: 6 }}>
                <button onClick={() => apiFetch("/api/inbox/client-approve", { method: "POST", body: JSON.stringify({ workspaceId, brandId, pieceId: p.id, decision: "aprobar" }), headers: { "x-client-token": token || "" } }).then(() => loadPieces(token!, brandId!))}
                  style={{ border: "1px solid rgba(0,184,79,.5)", background: "rgba(0,184,79,.12)", color: "inherit", borderRadius: 999, padding: "6px 14px", cursor: "pointer", fontSize: 13 }}>
                  Aprobar
                </button>
                <button onClick={() => apiFetch("/api/inbox/client-approve", { method: "POST", body: JSON.stringify({ workspaceId, brandId, pieceId: p.id, decision: "cambios" }), headers: { "x-client-token": token || "" } }).then(() => loadPieces(token!, brandId!))}
                  style={{ border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "inherit", borderRadius: 999, padding: "6px 14px", cursor: "pointer", fontSize: 13 }}>
                  Pedir cambios
                </button>
              </div>
            )}
          </div>
        ))}
        {!loading && pieces.length === 0 && <p style={{ opacity: 0.6, fontSize: 14 }}>Sin piezas esta semana.</p>}
      </div>
    </div>
  );
}
