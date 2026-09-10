import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ONBOARDING_GOALS, getOnboardingGoal, type OnboardingGoalId } from "../../shared/personalizedOnboarding";
import { apiFetch } from "../lib/supabase";

type Progress = { goal_id: OnboardingGoalId; completed_at: string | null; completion_source: "self" | "system" | null };

function go(route: string) {
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Guide({ goal, onClose }: { goal: NonNullable<ReturnType<typeof getOnboardingGoal>>; onClose: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const measure = () => setRect(goal.target ? document.querySelector(goal.target)?.getBoundingClientRect() || null : null);
    measure(); const id = window.setInterval(measure, 300); window.addEventListener("resize", measure);
    return () => { clearInterval(id); window.removeEventListener("resize", measure); };
  }, [goal]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);
  return createPortal(<>
    {rect ? <div style={{ position: "fixed", left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10, borderRadius: 12, border: "2px solid #a78bfa", boxShadow: "0 0 0 200vmax rgba(4,4,14,.78)", zIndex: 9998, pointerEvents: "none" }} /> : <div style={{ position: "fixed", inset: 0, background: "rgba(4,4,14,.78)", zIndex: 9998 }} />}
    <section role="dialog" aria-label={`Guía: ${goal.title}`} onKeyDown={event => { if (event.key === "Escape") onClose(); }} style={{ position: "fixed", zIndex: 9999, right: 24, bottom: 84, width: 360, maxWidth: "calc(100vw - 32px)", borderRadius: 16, padding: 20, color: "#fff", background: "#17151f", border: "1px solid rgba(255,255,255,.15)", boxShadow: "0 20px 60px rgba(0,0,0,.5)" }}>
      <p style={{ color: "#c4b5fd", margin: "0 0 8px", fontSize: 12, fontWeight: 700 }}>GUÍA PERSONALIZADA</p>
      <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>{goal.title}</h2>
      <p style={{ color: "rgba(255,255,255,.76)", lineHeight: 1.5, margin: "0 0 16px" }}>{goal.guide}</p>
      {!rect && <p style={{ color: "rgba(255,255,255,.52)", fontSize: 12 }}>Llegaste a la sección correcta. El control se abre cuando haya contenido de tu workspace.</p>}
      <button ref={closeRef} type="button" onClick={onClose} style={{ border: 0, borderRadius: 8, padding: "9px 14px", background: "#7c3aed", color: "#fff", cursor: "pointer", fontWeight: 700 }}>Entendido</button>
    </section>
  </>, document.body);
}

export function PersonalizedOnboardingPlan() {
  const [progress, setProgress] = useState<Progress[]>([]); const [loaded, setLoaded] = useState(false); const [open, setOpen] = useState(false); const [editing, setEditing] = useState(false); const [guideId, setGuideId] = useState<OnboardingGoalId | null>(null); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const selected = useMemo(() => new Set(progress.map(p => p.goal_id)), [progress]);
  useEffect(() => { void apiFetch<{ data?: Progress[] }>("/api/onboarding/progress").then(r => setProgress(r.data || [])).catch(() => setError("No pudimos cargar tu plan todavía.")).finally(() => setLoaded(true)); }, []);
  if (!loaded) return null;
  const complete = progress.filter(p => p.completed_at).length;
  const toggleComplete = async (goalId: OnboardingGoalId, done: boolean) => { setError(""); setSaving(true); try { await apiFetch(`/api/onboarding/progress/${goalId}`, { method: "PATCH", body: JSON.stringify({ completed: done }) }); setProgress(items => items.map(p => p.goal_id === goalId ? { ...p, completed_at: done ? new Date().toISOString() : null, completion_source: done ? "self" : null } : p)); } catch { setError("No se pudo guardar el avance. Inténtalo otra vez."); } finally { setSaving(false); } };
  const saveGoals = async (ids: OnboardingGoalId[]) => { setError(""); setSaving(true); try { await apiFetch("/api/onboarding/goals", { method: "PUT", body: JSON.stringify({ goalIds: ids }) }); setProgress(old => ids.map(goal_id => old.find(p => p.goal_id === goal_id) || { goal_id, completed_at: null, completion_source: null })); setEditing(false); } catch { setError("No se pudieron actualizar tus objetivos. Inténtalo otra vez."); } finally { setSaving(false); } };
  const begin = (id: OnboardingGoalId) => { const goal = getOnboardingGoal(id); if (!goal) return; setOpen(false); go(goal.route); window.setTimeout(() => setGuideId(id), 150); };
  return <>
    <aside className={`onboarding-plan${open ? " is-open" : ""}`} aria-label="Tu plan de aprendizaje">
      <button className="onboarding-plan-trigger" type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}><span><strong>Tu plan</strong> <small>{complete}/{progress.length}</small></span><span aria-hidden="true">{open ? "⌄" : "⌃"}</span></button>
      {open && <div className="onboarding-plan-body" aria-busy={saving}>
        {error && <p className="onboarding-plan-error" role="alert">{error}</p>}
        <button className="onboarding-plan-edit" type="button" onClick={() => setEditing(v => !v)} disabled={saving}>{editing ? "Cancelar edición" : "Editar objetivos"}</button>
        {editing ? <GoalEditor selected={selected} onSave={saveGoals} saving={saving} /> : progress.map(item => { const goal = getOnboardingGoal(item.goal_id); return goal && <div className="onboarding-plan-goal" key={goal.id}><input aria-label={`Marcar ${goal.title} como hecho`} type="checkbox" checked={Boolean(item.completed_at)} disabled={saving} onChange={e => void toggleComplete(goal.id, e.target.checked)} /><button type="button" onClick={() => begin(goal.id)} disabled={saving} className={item.completed_at ? "is-complete" : ""}>{goal.title}</button></div>; })}
      </div>}
    </aside>
    {guideId && getOnboardingGoal(guideId) && <Guide goal={getOnboardingGoal(guideId)!} onClose={() => setGuideId(null)} />}
  </>;
}

function GoalEditor({ selected, onSave, saving }: { selected: Set<OnboardingGoalId>; onSave: (ids: OnboardingGoalId[]) => void; saving: boolean }) {
  const [ids, setIds] = useState(() => new Set(selected));
  return <div className="onboarding-plan-editor">{ONBOARDING_GOALS.map(goal => <label key={goal.id}><input type="checkbox" checked={ids.has(goal.id)} disabled={saving} onChange={() => setIds(prev => { const next = new Set(prev); next.has(goal.id) ? next.delete(goal.id) : next.add(goal.id); return next; })} /><span>{goal.title}</span></label>)}<button className="onboarding-plan-save" type="button" disabled={saving} onClick={() => onSave([...ids])}>{saving ? "Guardando…" : "Guardar objetivos"}</button></div>;
}
