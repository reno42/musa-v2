/**
 * ShellV2.tsx — La ÚNICA cara de Musa v2 (REQ-069/REQ-070).
 *
 * Sidebar de 10 módulos + routing hash `#mod/sub` (linkable, sobrevive
 * refresh) + nav personalizable por rol (pin/ocultar/drag, persistido en
 * localStorage por workspace+rol) + selector de los 7 roles del prototipo.
 *
 * El shell NO reusa ninguna página de v1: las vistas vienen del registro
 * router.tsx y los datos de src/lib/apiV2. El editor `#template/<id>` queda
 * fuera del shell (App.tsx lo monta igual, congelado por REQ-068).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MODULES,
  ROLES,
  ROUTE_BY_ID,
  firstRouteOf,
  moduleById,
  type NavPrefs,
  type V2Module,
} from "./navConfig";
import { viewForRoute } from "./router";
import {
  loadNavPrefs,
  loadRole,
  loadTheme,
  placeModule,
  reorderWithin,
  saveNavPrefs,
  saveRole,
  saveTheme,
} from "./navPrefs";
import { fetchWorkspaces } from "../lib/apiV2/inicio";
import { DsIcon } from "../components/v2/ds";
import "./shell.css";

export interface ShellV2Props {
  /** Workspace de la sesión actual (del AuthProvider). */
  workspaceId: string | null;
  /** Nombre visible del usuario (para el pie del sidebar). */
  accountName?: string;
  /** Abrir un diseño en el editor #template/<id> (intacto, REQ-068). */
  onOpenTemplate: (templateId: string) => void;
}

/** Lee la ruta v2 actual del hash; null si el hash no es del shell. */
function readRouteId(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (ROUTE_BY_ID.has(hash)) return hash;
  if (moduleById(hash)) return firstRouteOf(hash); // "#crear" → su primer sub
  return null;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

export function ShellV2({ workspaceId, accountName, onOpenTemplate }: ShellV2Props) {
  const [roleId, setRoleId] = useState<string>(() => loadRole());
  const [routeId, setRouteId] = useState<string>(() => readRouteId() ?? ROLES.find(r => r.id === loadRole())!.home);
  const [prefs, setPrefs] = useState<NavPrefs>(() => loadNavPrefs(workspaceId, loadRole()));
  const [openMods, setOpenMods] = useState<Set<string>>(() => new Set([routeId.split("/")[0]]));
  const [theme, setTheme] = useState<"dark" | "light">(() => loadTheme());
  const [sideOpen, setSideOpen] = useState(false);
  const [wsName, setWsName] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const role = ROLES.find(r => r.id === roleId) ?? ROLES[0];
  const meta = ROUTE_BY_ID.get(routeId);

  /* ── Fuentes del prototipo (Anton + Inter): solo mientras el shell vive. ── */
  useEffect(() => {
    const id = "ds-v2-fonts";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;700;900&display=swap";
      document.head.appendChild(link);
    }
    return () => {
      document.getElementById(id)?.remove();
    };
  }, []);

  /* ── Routing hash: linkable y sobrevive refresh (REQ-069). ── */
  useEffect(() => {
    const onHash = () => {
      const next = readRouteId();
      if (next) setRouteId(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Hash no-v2 al montar (p. ej. #workspace con v2 ON): URL canónica del home
  // del rol, sin sumar entrada al historial.
  useEffect(() => {
    if (!readRouteId()) {
      window.history.replaceState(null, "", `#${routeId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mod = routeId.split("/")[0];
    setOpenMods(prev => (prev.has(mod) ? prev : new Set(prev).add(mod)));
  }, [routeId]);

  /* ── Nombre del espacio actual (cosmético; vía apiV2, sin fetch propio). ── */
  useEffect(() => {
    let active = true;
    fetchWorkspaces()
      .then(list => {
        if (!active) return;
        const current = workspaceId ? list.find(w => w.id === workspaceId) : undefined;
        setWsName(typeof current?.name === "string" ? current.name : null);
      })
      .catch(() => { /* el nombre del card es cosmético */ });
    return () => { active = false; };
  }, [workspaceId]);

  const go = useCallback((next: string) => {
    window.location.hash = next; // hashchange actualiza el estado
    setSideOpen(false);
  }, []);

  const changeRole = useCallback((nextRole: string) => {
    const home = ROLES.find(r => r.id === nextRole)?.home ?? "inicio/resumen";
    setRoleId(nextRole);
    saveRole(nextRole);
    setPrefs(loadNavPrefs(workspaceId, nextRole));
    setOpenMods(new Set([home.split("/")[0]]));
    go(home);
  }, [workspaceId, go]);

  const mutatePrefs = useCallback((next: NavPrefs) => {
    setPrefs(next);
    saveNavPrefs(workspaceId, roleId, next);
  }, [workspaceId, roleId]);

  const hideModule = useCallback((mod: string) => {
    const next = placeModule(prefs, mod, "hid");
    mutatePrefs(next);
    // Si la vista activa quedó oculta, aterrizar en el primer módulo visible.
    if (routeId.startsWith(`${mod}/`)) {
      const firstVisible = next.pin[0] ?? next.rest[0];
      if (firstVisible) go(firstRouteOf(firstVisible));
    }
  }, [prefs, mutatePrefs, routeId, go]);

  const onDrop = useCallback((targetId: string) => {
    if (dragId && dragId !== targetId) mutatePrefs(reorderWithin(prefs, dragId, targetId));
    setDragId(null);
    setDropTarget(null);
  }, [dragId, prefs, mutatePrefs]);

  const ActiveView = useMemo(() => viewForRoute(routeId), [routeId]);

  // Ruta inválida (hash huérfano): home del rol.
  useEffect(() => {
    if (!ActiveView) go(role.home);
  }, [ActiveView, role.home, go]);

  const moduleItem = (m: V2Module, section: "pin" | "rest") => {
    const isOpen = openMods.has(m.id);
    const active = routeId.startsWith(`${m.id}/`);
    return (
      <div
        key={`${section}-${m.id}`}
        className={`ds-mod${isOpen ? " open" : ""}${active ? " on" : ""}${dragId === m.id ? " dragging" : ""}${dropTarget === m.id ? " drop-target" : ""}`}
        draggable
        onDragStart={() => setDragId(m.id)}
        onDragEnd={() => { setDragId(null); setDropTarget(null); }}
        onDragOver={e => { e.preventDefault(); if (dragId && dragId !== m.id) setDropTarget(m.id); }}
        onDrop={e => { e.preventDefault(); onDrop(m.id); }}
      >
        <button
          type="button"
          className="ds-mod-h"
          title={m.description}
          onClick={() => go(firstRouteOf(m.id))}
        >
          <DsIcon icon={m.icon} />
          <span>{m.label}</span>
          <span className="ds-mod-acts">
            <button
              type="button"
              className={section === "pin" ? "on" : ""}
              title={section === "pin" ? "Quitar de Tu espacio" : "Anclar en Tu espacio"}
              aria-label={section === "pin" ? `Quitar ${m.label} de Tu espacio` : `Anclar ${m.label} en Tu espacio`}
              onClick={e => { e.stopPropagation(); mutatePrefs(placeModule(prefs, m.id, section === "pin" ? "rest" : "pin")); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill={section === "pin" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
            </button>
            <button
              type="button"
              title={`Ocultar ${m.label}`}
              aria-label={`Ocultar ${m.label} del menú`}
              onClick={e => { e.stopPropagation(); hideModule(m.id); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </span>
          <svg className="ds-car" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>
        </button>
        <div className="ds-subs">
          {m.subs.map(s => (
            <a
              key={s.id}
              href={`#${m.id}/${s.id}`}
              className={routeId === `${m.id}/${s.id}` ? "on" : ""}
              onClick={() => setSideOpen(false)}
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`ds-shell${theme === "light" ? " ds-light" : ""}`}>
      <aside className={`ds-side${sideOpen ? " open" : ""}`}>
        <div className="ds-brand">
          <b>Musa</b>
          <span>by Futuraria</span>
        </div>

        <div className="ds-ws">
          <i>{initialsOf(wsName ?? "Mi espacio")}</i>
          <div>
            <b>{wsName ?? "Mi espacio"}</b>
            <small>{role.label.split(" · ")[0]}</small>
          </div>
        </div>

        <div className="ds-role">
          <span>Ver como</span>
          <select
            value={roleId}
            aria-label="Rol activo de la navegación"
            onChange={e => changeRole(e.target.value)}
          >
            {ROLES.map(r => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>

        <nav className="ds-nav" aria-label="Módulos">
          {prefs.pin.length > 0 && <div className="ds-nav-label">Tu espacio</div>}
          {prefs.pin.map(id => {
            const m = moduleById(id);
            return m ? moduleItem(m, "pin") : null;
          })}
          {prefs.rest.length > 0 && <div className="ds-nav-label">Más módulos</div>}
          {prefs.rest.map(id => {
            const m = moduleById(id);
            return m ? moduleItem(m, "rest") : null;
          })}
        </nav>

        {prefs.hid.length > 0 && (
          <div className="ds-hidden">
            <div className="ds-nav-label">Ocultos</div>
            {prefs.hid.map(id => {
              const m = moduleById(id);
              if (!m) return null;
              return (
                <button
                  key={`hid-${m.id}`}
                  type="button"
                  className="ds-mod-h"
                  title={`${m.label} — mostrar de nuevo`}
                  onClick={() => mutatePrefs(placeModule(prefs, m.id, "rest"))}
                >
                  <DsIcon icon={m.icon} />
                  <span>{m.label}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto" }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              );
            })}
          </div>
        )}

        <div className="ds-side-foot">
          <span className="ds-av">{initialsOf(accountName ?? "?")}</span>
          <div>
            <b>{accountName ?? "Cuenta"}</b>
            <small>{MODULES.length} módulos · {ROUTE_BY_ID.size} vistas</small>
          </div>
        </div>
      </aside>

      <main className="ds-main">
        <div className="ds-top">
          <button
            type="button"
            className="ds-burger"
            aria-label="Abrir menú"
            onClick={() => setSideOpen(v => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <div className="ds-crumb">
            <span>{meta?.module.label ?? "Musa"}</span>
            <span aria-hidden="true">›</span>
            <b>{meta?.label ?? ""}</b>
          </div>
          <div className="ds-top-right">
            <button
              type="button"
              className="ds-icon-btn"
              title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
              aria-label="Cambiar tema"
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                setTheme(next);
                saveTheme(next);
              }}
            >
              {theme === "dark" ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>
              )}
            </button>
            <span className="ds-av">{initialsOf(accountName ?? "?")}</span>
          </div>
        </div>

        {ActiveView ? (
          <ActiveView meta={meta!} onOpenTemplate={onOpenTemplate} />
        ) : null}
      </main>
    </div>
  );
}
