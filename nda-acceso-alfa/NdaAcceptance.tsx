// ============================================================
// NdaAcceptance.tsx — paso de aceptación del Acuerdo Alfa
// (Friends & Family / Corporativo) para el flujo de creación
// de cuenta del editor.
//
// Autónomo: no depende de nada del editor salvo React.
// Los estilos son inline para que Qoder los adapte al design
// system del editor sin tocar la lógica.
// ============================================================

import { useCallback, useState } from 'react';
import {
  NDA_SUPABASE_URL,
  NDA_SUPABASE_PUBLISHABLE_KEY,
  NDA_TABLE,
  NDA_VERSION,
  planOptions,
  planBullets,
  ndaSections,
  type PlanId,
} from './ndaContent';

export interface NdaAcceptanceProps {
  /** Nombre completo, prefilled desde el formulario de cuenta. */
  fullName: string;
  /** Email, prefilled desde el formulario de cuenta. */
  email: string;
  /** Se dispara SOLO tras insertar la aceptación en Supabase con éxito. */
  onAccepted: (record: { plan: PlanId; acceptedAt: string }) => void;
  onCancel?: () => void;
}

type Status = 'idle' | 'loading' | 'error';

const c = {
  wrap: { color: '#f2f3ee', background: '#121216', border: '1px solid #26262f', borderRadius: 16, padding: 28, maxWidth: 680, margin: '0 auto' } as React.CSSProperties,
  h2: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' } as React.CSSProperties,
  sub: { color: '#9a9aa6', fontSize: 13.5, margin: '6px 0 22px' } as React.CSSProperties,
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: '#f2f3ee', margin: '18px 0 8px' } as React.CSSProperties,
  planRow: { display: 'flex', gap: 10, flexWrap: 'wrap' } as React.CSSProperties,
  planCard: (active: boolean): React.CSSProperties => ({
    flex: 1, minWidth: 220, padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
    border: active ? '1px solid #d2ff02' : '1px solid #26262f',
    color: active ? '#f2f3ee' : '#9a9aa6', background: active ? 'rgba(210,255,2,0.06)' : 'transparent',
  }),
  planTitle: { fontWeight: 800, fontSize: 14, color: '#f2f3ee', display: 'flex', gap: 8, alignItems: 'center' } as React.CSSProperties,
  planDetail: { fontSize: 12, color: '#9a9aa6', marginTop: 3 } as React.CSSProperties,
  bullets: { margin: '8px 0 0 18px', padding: 0, fontSize: 12.5, color: '#c9c9d2', lineHeight: 1.6 } as React.CSSProperties,
  doc: { marginTop: 22, maxHeight: 320, overflowY: 'auto', border: '1px solid #26262f', borderRadius: 12, padding: '16px 18px', background: '#0a0a0c', fontSize: 12.5, color: '#c9c9d2' } as React.CSSProperties,
  secTitle: { color: '#f2f3ee', fontWeight: 700, fontSize: 12.5, margin: '14px 0 5px' } as React.CSSProperties,
  secBody: { margin: '0 0 6px', lineHeight: 1.6 } as React.CSSProperties,
  secBullets: { margin: '0 0 6px 16px', padding: 0 } as React.CSSProperties,
  check: { display: 'flex', gap: 10, alignItems: 'flex-start', margin: '18px 0 20px', cursor: 'pointer' } as React.CSSProperties,
  checkInput: { width: 17, height: 17, marginTop: 2, accentColor: '#d2ff02', cursor: 'pointer' } as React.CSSProperties,
  checkText: { fontSize: 12.5, color: '#9a9aa6', lineHeight: 1.5 } as React.CSSProperties,
  btn: (disabled: boolean): React.CSSProperties => ({
    width: '100%', padding: 14, borderRadius: 11, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? '#3a3a42' : '#d2ff02', color: '#0a0a0c', fontWeight: 800, fontSize: 15,
  }),
  cancel: { width: '100%', marginTop: 10, padding: 10, background: 'transparent', border: 'none', color: '#9a9aa6', cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
  error: { marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.35)', color: '#ff7a7a', fontSize: 13 } as React.CSSProperties,
};

export function NdaAcceptance({ fullName, email, onAccepted, onCancel }: NdaAcceptanceProps) {
  const [plan, setPlan] = useState<PlanId>('friends_family');
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    if (!accepted) {
      setError('Debes marcar la casilla de aceptación para continuar.');
      return;
    }
    setStatus('loading');
    setError('');

    let ip: string | null = null;
    try {
      ip = (await (await fetch('https://api.ipify.org?format=json')).json()).ip;
    } catch {
      /* IP opcional */
    }

    const body = {
      full_name: fullName,
      email: email || null,
      plan,
      ip_address: ip,
      user_agent: navigator.userAgent,
      version: NDA_VERSION,
    };

    try {
      const res = await fetch(`${NDA_SUPABASE_URL}/rest/v1/${NDA_TABLE}`, {
        method: 'POST',
        headers: {
          apikey: NDA_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${NDA_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onAccepted({ plan, acceptedAt: new Date().toISOString() });
      } else {
        let msg = '';
        try {
          msg = (await res.json()).message || '';
        } catch {
          /* sin detalle */
        }
        setStatus('error');
        setError(`No se pudo registrar tu aceptación (${res.status}). ${msg}`);
      }
    } catch {
      setStatus('error');
      setError('Error de conexión. Intenta de nuevo.');
    }
  }, [accepted, fullName, email, plan, onAccepted]);

  return (
    <div style={c.wrap}>
      <h2 style={c.h2}>Acuerdo de Acceso Alfa</h2>
      <p style={c.sub}>Confidencial · Futuraria. Léelo y confirma para crear tu cuenta.</p>

      <span style={c.label}>Plan de acceso</span>
      <div style={c.planRow}>
        {planOptions.map((opt) => (
          <div key={opt.value} style={c.planCard(plan === opt.value)} onClick={() => setPlan(opt.value)}>
            <div style={c.planTitle}>
              <input
                type="radio"
                name="nda-plan"
                checked={plan === opt.value}
                onChange={() => setPlan(opt.value)}
                style={{ accentColor: '#d2ff02' }}
              />
              {opt.label}
            </div>
            <div style={c.planDetail}>{opt.detail}</div>
          </div>
        ))}
      </div>
      <ul style={c.bullets}>
        {planBullets[plan].map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>

      <div style={c.doc}>
        {ndaSections.map((s) => (
          <div key={s.title}>
            <div style={c.secTitle}>{s.title}</div>
            {s.body && <p style={c.secBody}>{s.body}</p>}
            {s.bullets && (
              <ul style={c.secBullets}>
                {s.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <label style={c.check}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          style={c.checkInput}
        />
        <span style={c.checkText}>
          He leído el acuerdo y <b style={{ color: '#f2f3ee' }}>acepto</b> sus términos. Entiendo que
          grabar, transcribir, scrapear o clonar la herramienta cancela mi acceso de forma permanente.
        </span>
      </label>

      <button style={c.btn(status === 'loading' || !accepted)} onClick={submit} disabled={status === 'loading' || !accepted}>
        {status === 'loading' ? 'Registrando…' : 'Acepto y creo mi cuenta'}
      </button>
      {onCancel && (
        <button style={c.cancel} onClick={onCancel} disabled={status === 'loading'}>
          Cancelar
        </button>
      )}
      {error && <div style={c.error}>{error}</div>}
    </div>
  );
}
