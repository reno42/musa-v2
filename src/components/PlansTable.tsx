import { useEffect, useState } from "react";

// Tabla de planes compartida por la landing y la pantalla de planes de la cuenta.
// Datos: /api/billing/plans (billing_plans). Tres tamaños × dos modos × mensual/anual.
export type Plan = {
  code: string; name: string; mode: "byok" | "musa_ia"; segment: string; interval: "month" | "year" | "once"; price_usd: number;
  kind: "plan" | "seat" | "pack"; credits_month: number; intro_credits: number | null; seats: number | null; brands: number | null;
  emails_month: number | null; intro_price_usd: number | null; intro_months: number | null; annual_of: string | null; pack_credits: number | null;
  purchasable: boolean; entitlements?: { features?: string[] };
};
export type PlansData = { plans: Plan[]; configured: boolean; founder_until: string | null };

export function usePlans() {
  const [d, setD] = useState<PlansData | null>(null);
  useEffect(() => {
    fetch("/api/billing/plans").then((r) => r.json()).then((j) => setD({ plans: (j.plans || []).filter((p: Plan) => p.purchasable), configured: !!j.configured, founder_until: j.founder_until || null }), () => setD({ plans: [], configured: false, founder_until: null }));
  }, []);
  return d;
}

const TIERS: [string, string, string][] = [
  ["creador", "Creador", "Para freelancers y creadores"],
  ["agencia", "Agencia", "Para agencias y equipos"],
  ["empresa", "Empresa", "Para empresas con varias áreas"],
];
const n = (x: number) => Number(x).toLocaleString("en-US");
const fdate = (iso: string) => { try { return new Date(iso + "T12:00:00Z").toLocaleDateString((window as unknown as { musaI18n?: { lang: string } }).musaI18n?.lang === "en" ? "en-US" : "es-PE", { day: "numeric", month: "long", year: "numeric" }); } catch { return iso; } };

export function PlansTable({ data, onPick, busy, highlight, dark }: { data: PlansData; onPick: (code: string) => void; busy?: string; highlight?: string; dark?: boolean }) {
  const [mode, setMode] = useState<"musa_ia" | "byok">("musa_ia");
  const [yearly, setYearly] = useState(false);
  const plans = data.plans.filter((p) => p.kind === "plan");
  const pick = (tier: string) => {
    const m = tier === "empresa" ? "musa_ia" : mode;
    return plans.find((p) => p.segment === tier && p.mode === m && p.interval === (yearly ? "year" : "month"));
  };
  const packs = data.plans.filter((p) => p.kind === "pack");
  const founder = data.founder_until && Date.now() < Date.parse(data.founder_until + "T23:59:59Z");
  if (!plans.length) return null;
  return (
    <div className={`mp ${dark ? "mp-dark" : "mp-light"}`}>
      <div className="mp-switches">
        <div className="mp-seg" role="group" aria-label="Modalidad">
          <button type="button" className={mode === "musa_ia" ? "on" : ""} onClick={() => setMode("musa_ia")}>Con IA de Musa</button>
          <button type="button" className={mode === "byok" ? "on" : ""} onClick={() => setMode("byok")}>Tus llaves (BYOK)</button>
        </div>
        <div className="mp-seg" role="group" aria-label="Facturación">
          <button type="button" className={!yearly ? "on" : ""} onClick={() => setYearly(false)}>Mensual</button>
          <button type="button" className={yearly ? "on" : ""} onClick={() => setYearly(true)}>Anual<small>2 meses gratis</small></button>
        </div>
      </div>
      <div className="mp-grid">
        {TIERS.map(([tier, label, sub]) => {
          const p = pick(tier); if (!p) return null;
          const monthly = p.interval === "year" ? Math.round(p.price_usd / 12) : p.price_usd;
          const intro = p.interval === "month" && p.intro_price_usd != null;
          const hot = tier === "agencia";
          return (
            <article key={tier} className={`mp-card${hot ? " hot" : ""}${highlight && (highlight === p.code || highlight === p.annual_of) ? " picked" : ""}`}>
              <span className="mp-tag">{p.mode === "musa_ia" ? "Con IA de Musa" : "Tus llaves (BYOK)"}</span>
              <h3>{label}</h3>
              <p className="mp-sub">{sub}</p>
              {intro ? (
                <>
                  <div className="mp-amt">{`US$ ${n(p.intro_price_usd!)}`}<small> / mes</small></div>
                  <p className="mp-then">{`los primeros ${p.intro_months} meses · luego US$ ${n(p.price_usd)} / mes`}</p>
                </>
              ) : (
                <>
                  <div className="mp-amt">{`US$ ${n(monthly)}`}<small> / mes</small></div>
                  <p className="mp-then">{p.interval === "year" ? `US$ ${n(p.price_usd)} al año` : "facturado cada mes"}</p>
                </>
              )}
              <ul>
                <li>{p.seats === 1 ? "1 persona" : `${p.seats} personas${tier !== "creador" ? " (más con persona extra)" : ""}`}</li>
                <li>{p.brands == null ? "Marcas ilimitadas" : `${p.brands} marcas`}</li>
                <li>{p.mode === "musa_ia" ? `${n(p.credits_month)} créditos de IA al mes` : `Tus llaves de IA + ${n(p.credits_month)} créditos de prueba`}</li>
                <li>{`${n(p.emails_month || 0)} correos al mes`}</li>
                <li>{tier === "agencia" ? "Todos los módulos + portal de clientes" : tier === "empresa" ? "Todos los módulos + áreas y aprobaciones" : "Todos los módulos"}</li>
              </ul>
              <button type="button" className="mp-btn" disabled={!!busy} onClick={() => onPick(p.code)}>{busy === p.code ? "Abriendo pago…" : intro ? `Probar por US$ ${n(p.intro_price_usd!)}` : "Elegir plan"}</button>
            </article>
          );
        })}
      </div>
      <div className="mp-notes">
        {founder && <p><b>Precio fundador:</b> {`si te suscribes antes del ${fdate(data.founder_until!)}, tu precio queda congelado para siempre y recibes el doble de créditos los 3 primeros meses.`}</p>}
        <p><b>Invita y paga menos:</b> por cada persona que invites y pague su 2.º mes ganas medio mes; con 2, tu siguiente mes es gratis. Quien llega invitado tiene 4 meses de oferta en vez de 3.</p>
        {packs.length > 0 && <p><b>¿Necesitas más IA?</b> {`Paquetes de créditos: ${packs.map((p) => `${n(p.pack_credits || 0)} → US$ ${n(p.price_usd)}`).join(" · ")}. No vencen. 1 crédito = 1 imagen o unas 100 respuestas de texto.`}</p>}
      </div>
    </div>
  );
}
