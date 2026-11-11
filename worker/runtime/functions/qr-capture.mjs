// Códigos QR ↔ CRM (migración 41). Cuando alguien llega por un QR dinámico a un formulario, evento, website o diseño de
// Musa, la página manda el código (?qr=… → __qr en el envío). Aquí se valida que el QR sea del MISMO espacio que lo que
// se envió (un código ajeno no anota nada) y se registra a quién trajo: la fila en qr_captures y, en la persona del
// CRM, las etiquetas «qr» y «QR · <nombre>» y, si es nueva, el QR por el que entró (origin_qr_id). Nunca rompe el envío.
const CODE_RX = /^[A-Za-z0-9]{6,16}$/;

/** El QR (dinámico, del espacio ws) del código que mandó la página, o null. */
export async function qrForCapture(sb, code, ws) {
  const c = String(code || "").trim();
  if (!CODE_RX.test(c) || !ws) return null;
  try {
    const { data } = await sb.from("qr_codes").select("id,name,workspace_id,created_by,brand_id,fields,target_type,target_id").eq("code", c).eq("workspace_id", ws).eq("kind", "dynamic").maybeSingle();
    return data || null;
  } catch { return null; }
}

export const qrTags = (qr) => ["qr", ("QR · " + String(qr.name || "").trim()).slice(0, 60)];

/** Anota la captura. contactId: la persona del CRM (nueva o la que ya existía con ese correo). */
export async function recordQrCapture(sb, qr, { contactId = null, isNew = false, kind, name = null, email = null }) {
  if (!qr) return;
  try {
    await sb.from("qr_captures").insert({ qr_id: qr.id, kind, contact_id: contactId, name: name ? String(name).slice(0, 160) : null, email: email ? String(email).slice(0, 200) : null, new_contact: !!(contactId && isNew) });
    if (!contactId) return;
    const { data: c } = await sb.from("crm_contacts").select("tags,origin_qr_id").eq("id", contactId).maybeSingle();
    if (!c) return;
    const tags = Array.isArray(c.tags) ? c.tags.slice() : [];
    for (const t of qrTags(qr)) if (!tags.includes(t)) tags.push(t);
    const patch = { tags };
    if (isNew && !c.origin_qr_id) patch.origin_qr_id = qr.id;
    await sb.from("crm_contacts").update(patch).eq("id", contactId);
  } catch (e) { console.error("[qr-capture]", e && e.message); }
}
