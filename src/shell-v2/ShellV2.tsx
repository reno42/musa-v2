/**
 * ShellV2.tsx — La cara de Musa v2 ES la maqueta `musa-plataforma-mticket.html`.
 *
 * Decisión de Renzo (2026-11-01): la web debe verse exactamente como la
 * maqueta. En vez de reescribir sus vistas en React (lo que cambió
 * proporciones y agregó cosas que no existían), la maqueta se sirve tal cual
 * desde public/musa/index.html y se monta a pantalla completa.
 *
 * Los datos reales llegan por public/musa/bridge.js, que usa este puente
 * (window.__musaBridge) para llamar a la API con la sesión de la app.
 */
import { useEffect, useRef } from "react";
import { apiFetch } from "../lib/supabase";
import { getApiHeaders } from "../lib/apiKey";

export interface ShellV2Props {
  workspaceId: string | null;
  accountName?: string;
  userId?: string | null;
  userEmail?: string;
  onOpenTemplate: (templateId: string) => void;
  onOpenVideoProject?: (projectId: string) => void;
  onOpenTomas?: () => void;
  /** Cierra la sesión y vuelve a la landing (botón «Cerrar sesión» de la maqueta). */
  onSignOut?: () => void;
}

declare global {
  interface Window {
    __musaBridge?: {
      workspaceId: string | null;
      accountName?: string;
      userId?: string | null;
      userEmail?: string;
      api: <T>(url: string, init?: RequestInit) => Promise<T>;
      /** Respuesta cruda (audio, binarios) con la misma sesión que api(). */
      fetchRaw?: (url: string, init?: RequestInit) => Promise<Response>;
      openTemplate: (id: string) => void;
      openVideoProject?: (id: string) => void;
      signOut?: () => void;
    };
  }
}

export function ShellV2({ workspaceId, accountName, userId, userEmail, onOpenTemplate, onOpenVideoProject, onSignOut }: ShellV2Props) {
  // La ruta inicial sale del hash de la app; después la maqueta manda.
  const src = useRef(`/musa/index.html${window.location.hash || "#inicio/resumen"}`);

  window.__musaBridge = {
    workspaceId,
    accountName,
    userId,
    userEmail,
    api: (url, init) => apiFetch(url, init),
    fetchRaw: (url, init) => {
      const headers = new Headers(getApiHeaders());
      new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
      return fetch(url, { ...init, headers });
    },
    openTemplate: onOpenTemplate,
    openVideoProject: onOpenVideoProject,
    signOut: onSignOut,
  };

  useEffect(() => () => { delete window.__musaBridge; }, []);

  // Padre → iframe: atrás/adelante del navegador o un enlace que cambia el hash de la app mueven la
  // maqueta a esa ruta. (Iframe → padre lo hace bridge.js con replaceState, que no dispara hashchange,
  // así que no hay rebote.) La ruta estable del padre (p. ej. crear/disenos/tpl:<id>) la entiende el iframe.
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const follow = () => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      try {
        const want = window.location.hash || "#inicio/resumen";
        if (win.location.hash !== want) win.location.hash = want;
      } catch { /* mismo origen; si no, no hay nada que sincronizar */ }
    };
    window.addEventListener("hashchange", follow);
    window.addEventListener("popstate", follow);
    return () => { window.removeEventListener("hashchange", follow); window.removeEventListener("popstate", follow); };
  }, []);

  return (
    <iframe
      ref={frameRef}
      title="Musa"
      src={src.current}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0, background: "#0b0b0b" }}
    />
  );
}
