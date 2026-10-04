import { useEffect, useId, useState, type ComponentType, type ReactNode } from "react";
import { InviteAisCatalog } from "./InviteAisCatalog";
import { CrmWorkspace } from "./CrmWorkspace";
import { ReportsSection } from "./ReportsSection";
import { ApiWebhooksSection } from "./ApiWebhooksSection";

type Section = "account" | "integrations" | "humans" | "ais" | "reports" | "apis" | "docs";
type ConsoleMode = "crm" | "settings";
// v53: cuatro secciones con la jerarquía compartida del CRM — tarjeta superior
// glass con título serif y nav de ÍCONOS a la altura del título (hover muestra
// la palabra, mismo patrón que la nav del CRM). Reparto: Mi cuenta (perfil,
// preferencias y uso — slot del Dashboard), Mis integraciones (claves de IA del
// Dashboard), Invita colegas (equipo e invitaciones del Dashboard) e Invita IAs
// (llave MCP, prompts por harness, MCPs BYOK del equipo y SKILL.md).
// v61: los MCPs BYOK salieron de «Mis integraciones» — viven en «Invita IAs».
// v54: cada sección se presenta por su nombre — título y descriptor
// propios en la tarjeta (la tarjeta ya no dice siempre «Configuración»).
// v55: sin CTA en la tarjeta — la tarjeta solo presenta (título, descriptor
// y nav de íconos); la acción vive dentro de cada sección.
// v56: «Documentación» — el catálogo completo de herramientas (tool en código,
// MCP, UI, módulo, nombre humano) al lado de «Invita IAs», de donde salen las
// claves MCP.
// v57: «Documentación» es LOCAL-ONLY (regla explícita: la tabla de tools es el
// blueprint del producto y NUNCA sube al repo). Los dos archivos viven
// gitignoreados en disco; la pestaña solo existe en dev (import.meta.env.DEV)
// y el módulo se carga con spec computado + @vite-ignore para que ni rollup
// ni check-imports rastreen la importación.
// v58: «Reportes» — bugs de humanos y agentes en una sola cola con ESTADO
// (nuevo → en_progreso → corregido/descartado). MCP-first: el tool report_bug
// escribe la misma tabla; los reportes de IA traen pasos + hints de código.
const SETTINGS_SECTIONS: Array<{ id: Section; label: string; title: string; description: string; icon: ReactNode }> = [
  {
    id: "account",
    label: "Mi cuenta",
    title: "Mi cuenta",
    description: "Tu perfil, tus preferencias y el uso de tu espacio: todo te sigue a ti, no al workspace.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1-3.5 3.6-5.2 7-5.2s6 1.7 7 5.2" /></svg>
    ),
  },
  {
    id: "integrations",
    label: "Mis integraciones",
    title: "Mis integraciones",
    description: "Una sola caja fuerte: claves de IA cifradas que comparten el editor, el chat y los agentes de este workspace. Los MCPs externos viven en Invita IAs.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3v5M15 3v5" /><path d="M7 8h10v3a5 5 0 0 1-10 0V8z" /><path d="M12 16v5" /></svg>
    ),
  },
  {
    id: "humans",
    label: "Invita colegas",
    title: "Invita colegas",
    description: "Tu workspace gana con tu equipo: invita a quienes diseñan contigo y decide quién edita y quién solo mira.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10" cy="8.5" r="3.5" /><path d="M4 19.5c.8-3.2 3-4.8 6-4.8s5.2 1.6 6 4.8" /><path d="M18 6v6M15 9h6" /></svg>
    ),
  },
  {
    id: "ais",
    label: "Invita IAs",
    title: "Invita IAs",
    description: "Los agentes diseñan contigo: genera la llave MCP, copia el prompt de tu IA y pégalo — la llave viaja dentro del prompt.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="9" width="14" height="10" rx="2" /><path d="M12 9V5M9.5 5h5" /><circle cx="9.5" cy="14" r="1" /><circle cx="14.5" cy="14" r="1" /></svg>
    ),
  },
  {
    id: "reports",
    label: "Reportes",
    title: "Reportes",
    description: "Bugs reportados por tu equipo y por las IAs, con su estado: Nuevo, En progreso, Corregido o Descartado. Los de IA traen pasos exactos para replicar.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="7" width="8" height="11" rx="4" /><path d="M9 7a3 3 0 0 1 6 0" /><path d="M3 13h5M16 13h5M5 6l3 3M19 6l-3 3M5 20l3-3M19 20l-3-3" /></svg>
    ),
  },
  {
    // APIs/Webhooks (v60): la plataforma entera expuesta — claves REST,
    // REST documentada (OpenAPI) y webhooks salientes firmados para N8N,
    // Zapier y Make. v55: llaveros separados — las claves MCP se crean en
    // Invita IAs; las REST aquí.
    id: "apis",
    label: "APIs/Webhooks",
    title: "APIs/Webhooks",
    description: "Conecta Musa con lo que quieras: crea claves API, registra webhooks firmados y lee cómo funciona cada endpoint para N8N, Zapier o Make.",
    icon: (
      // Rayito (v60.1): el tacho de basura no decía «conexión» — el rayo
      // sí, y sin pisarle el enchufe a «Mis integraciones».
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
    ),
  },
  // LOCAL-ONLY: pestaña Documentación — dev solamente (ver v57 arriba).
  ...(import.meta.env.DEV ? [{
    id: "docs" as Section,
    label: "Documentación",
    title: "Documentación",
    description: "Las 100% de las herramientas del producto: qué hace cada una, si la usa la IA (MCP), si la usas tú (UI) y en qué módulo vive.",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    ),
  }] : []),
];

/** Loader local-only de la Documentación. El spec se computa en runtime:
 *  un literal haría que check-imports exigiera commitear el archivo y que
 *  rollup lo incluyera en el bundle de producción — exactamente lo que la
 *  regla prohíbe. En un build de prod esta rama nunca se monta. */
function DocsSectionLazy() {
  const [Comp, setComp] = useState<ComponentType | null>(null);
  useEffect(() => {
    let alive = true;
    const spec = "./" + "ToolsDocsSection";
    import(/* @vite-ignore */ spec)
      .then(m => { if (alive) setComp(() => (m as { ToolsDocsSection: ComponentType }).ToolsDocsSection); })
      .catch(() => { /* archivo presente solo en local; en prod no llega aquí */ });
    return () => { alive = false; };
  }, []);
  return Comp ? <Comp /> : null;
}
type WorkspaceConsoleProps = {
  workspaceId: string | null;
  workspaceName?: string;
  mode: ConsoleMode;
  onOpenTemplate?: (templateId: string) => void;
  /** v53: slots del Dashboard — Mi cuenta (perfil + preferencias + uso),
      Mis integraciones (claves de IA) e Invita colegas (equipo/invitaciones). */
  account?: ReactNode;
  integrations?: ReactNode;
  inviteHumans?: ReactNode;
  /** Deep-link del nav: #workspace/configuracion/<pane> aterriza aquí. */
  initialSection?: Section;
  /** El usuario cambió de sección in-page — el Dashboard la sube al nav y a la URL. */
  onSectionChange?: (section: Section) => void;
};

export function WorkspaceConsole({
  workspaceId,
  workspaceName,
  mode,
  onOpenTemplate,
  initialSection,
  onSectionChange,
  account,
  integrations,
  inviteHumans,
}: WorkspaceConsoleProps): JSX.Element {
  const [section, setSection] = useState<Section>(initialSection ?? "account");
  // Deep-link: un salto desde el nav del Dashboard manda la sección nueva.
  useEffect(() => { if (initialSection) setSection(initialSection); }, [initialSection]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const statusId = useId();

  if (!workspaceId) {
    return <div className="workspace-console-empty"><h2>Selecciona un workspace</h2><p>El CRM y la configuración siempre pertenecen a un workspace concreto.</p></div>;
  }

  // v54: la sección activa da título y descriptor a la tarjeta superior.
  const current = SETTINGS_SECTIONS.find(tab => tab.id === section) ?? SETTINGS_SECTIONS[0];
  const switchSection = (next: Section) => { setSection(next); setError(""); setNotice(""); onSectionChange?.(next); };

  return (
    <section className="workspace-console" aria-label={mode === "crm" ? "CRM" : undefined} aria-labelledby={mode === "settings" ? "workspace-console-title" : undefined}>
      {mode === "settings" && (
        <div className="crm-contacts">
          <div className="crm-table-card crm-contacts-top">
            <header className="crm-contacts-head">
              <div>
                <h1 id="workspace-console-title">{current.title}</h1>
                <p>{current.description}</p>
              </div>
              {/* Nav de ÍCONOS a la misma altura del título — mismo patrón que
                  la nav del CRM; el hover muestra la palabra (title). */}
              <div className="crm-nav-tabs" role="tablist" aria-label="Secciones de configuración">
                {SETTINGS_SECTIONS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={section === tab.id}
                    title={tab.label}
                    className={section === tab.id ? "crm-nav-tab active" : "crm-nav-tab"}
                    onClick={() => switchSection(tab.id)}
                  >
                    {tab.icon}
                  </button>
                ))}
              </div>
            </header>
          </div>
          {(error || notice) && <p id={statusId} className={error ? "workspace-status error" : "workspace-status success"} role={error ? "alert" : "status"}>{error || notice}</p>}
          {section === "account" && account}
          {section === "integrations" && integrations}
          {section === "humans" && inviteHumans}
          {section === "ais" && <InviteAisCatalog workspaceId={workspaceId} setError={setError} setNotice={setNotice} />}
          {section === "reports" && <ReportsSection workspaceId={workspaceId} />}
          {section === "apis" && <ApiWebhooksSection workspaceId={workspaceId} />}
          {section === "docs" && import.meta.env.DEV && <DocsSectionLazy />}
        </div>
      )}
      {mode === "crm" && (
        <CrmWorkspace
          workspaceId={workspaceId}
          onOpenTemplate={onOpenTemplate}
          setError={(message) => { setNotice(""); setError(message); }}
          setNotice={(message) => { setError(""); setNotice(message); }}
        />
      )}
    </section>
  );
}
