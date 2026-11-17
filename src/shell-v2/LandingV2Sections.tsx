/**
 * LandingV2Sections.tsx — secciones de conversión de la landing de Musa v2,
 * a partir del test de mercado del 2026-11-16 (enjambre MiroFish, 8 perfiles del ICP):
 * dolor del CM con calculadora, piezas reales («Hecho con Musa»), «tu marca, no
 * plantilla», para quién, tu IA (comprador técnico), preguntas frecuentes y confianza.
 * Cada texto vive en un solo nodo para que i18n.js lo traduzca (pares en i18n/es-en.json).
 */
import { useMemo, useState } from "react";
import type { Plan, PlansData } from "../components/PlansTable";

/** Tipo de cambio referencial para mostrar soles (SUNAT, venta, 17-nov-2026). Musa cobra en dólares. */
export const PEN_PER_USD = 3.42;
export const pen = (usd: number) => `≈ S/ ${Math.round(usd * PEN_PER_USD).toLocaleString("en-US")}`;
const usd = (n: number) => `US$ ${Math.round(n).toLocaleString("en-US")}`;

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

function plan(data: PlansData | null, segment: string, mode: "byok" | "musa_ia") {
  return data?.plans.find((p) => p.kind === "plan" && p.segment === segment && p.mode === mode && p.interval === "month");
}

/** Precio de entrada (oferta de los primeros meses) para el hero. */
export function entryOffer(data: PlansData | null): Plan | null {
  const intro = (data?.plans || []).filter((p) => p.kind === "plan" && p.interval === "month" && p.intro_price_usd != null);
  if (!intro.length) return null;
  return intro.reduce((a, b) => (a.intro_price_usd! <= b.intro_price_usd! ? a : b));
}

/* ── Tu semana: el dolor del CM, con sus propios números ── */
const PAINS: [string, string][] = [
  ["60 posts a la semana", "Entre 4 marcas, cada una con su tono, sus colores y su cliente."],
  ["8 formatos × 2 marcas", "Para el lunes. El mismo post, adaptado una y otra vez a mano."],
  ["Campañas a la 1:40 a. m.", "Porque el día se fue en variantes, no en estrategia."],
];

export function PainSection() {
  const [pieces, setPieces] = useState(60);
  const [minutes, setMinutes] = useState(12);
  const hours = Math.round((pieces * minutes) / 60);
  const month = Math.round((pieces * minutes * 4.3) / 60);
  return (
    <section className="mv2-sec" id="tu-semana" aria-labelledby="mv2-pain-t">
      <h2 id="mv2-pain-t">El problema no es la idea. <em>Son las variantes.</em></h2>
      <p>Si haces contenido para varias marcas, ya sabes dónde se va el tiempo: no en pensar la campaña, sino en producirla una y otra vez en cada formato.</p>
      <div className="mv2-pain">
        {PAINS.map(([big, small]) => (
          <article key={big} className="mv2-card dark">
            <h3>{big}</h3>
            <p>{small}</p>
          </article>
        ))}
      </div>
      <div className="mv2-calc">
        <div className="mv2-calc-in">
          <label>
            <span>Piezas que produces por semana</span>
            <span className="mv2-calc-row">
              <input type="range" min={5} max={200} step={5} value={pieces} onChange={(e) => setPieces(Number(e.target.value))} aria-label="Piezas por semana" />
              <output>{pieces}</output>
            </span>
          </label>
          <label>
            <span>Minutos adaptando cada una a mano</span>
            <span className="mv2-calc-row">
              <input type="range" min={2} max={45} step={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Minutos por pieza" />
              <output>{`${minutes} min`}</output>
            </span>
          </label>
        </div>
        <div className="mv2-calc-out" aria-live="polite">
          <b>{`${hours} h`}</b>
          <span>{`a la semana produciendo variantes · unas ${month} h al mes`}</span>
        </div>
        <p className="mv2-calc-note">Ese es el tiempo que Musa ataca: haces el diseño base una vez y la producción masiva y tu IA sacan el resto en lote —formatos, marcas, idiomas, filas de un CSV— con las reglas de cada marca. Por ejemplo, 8 formatos × 3 variantes son 24 piezas en un clic. A ti te queda revisar y aprobar.</p>
      </div>
    </section>
  );
}

/* ── Hecho con Musa: mismo brief, tres marcas (piezas reales del archivo «Landing · Un brief, tres marcas») ── */
const GALLERY: { id: string; name: string; kind: string; font: string; colors: string[]; alt: string }[] = [
  { id: "sonria", name: "Sonría", kind: "Clínica dental", font: "Nunito", colors: ["#0E6E66", "#F2B36B", "#EEF6F4", "#12302D"],
    alt: "Pieza de Sonría, clínica dental: «Tu sonrisa, lista para las fiestas», 30% de descuento en limpieza y blanqueamiento hasta el 31 de diciembre." },
  { id: "rutanorte", name: "Ruta Norte", kind: "Logística", font: "Barlow Condensed", colors: ["#FF6A13", "#111214", "#F4F1EA", "#1C1E22"],
    alt: "Pieza de Ruta Norte, logística: «Todo Lima en 24 horas», envíos desde S/ 9.90 en diciembre." },
  { id: "kuna", name: "Kuna", kind: "Fintech", font: "Fraunces + Inter", colors: ["#0F3D2E", "#C6F432", "#F4EFE6", "#0B1F18"],
    alt: "Pieza de Kuna, fintech: «Transfiere sin comisión todo diciembre», con una transferencia de S/ 1,250.00 y comisión S/ 0.00." },
];

export function GallerySection() {
  const [fmt, setFmt] = useState<"post" | "story">("post");
  return (
    <section className="mv2-sec" id="ejemplos" aria-labelledby="mv2-gal-t">
      <h2 id="mv2-gal-t">Un brief. Tres marcas. <em>Cero plantillas.</em></h2>
      <p>Mismo encargo para las tres: «anuncia la promo de diciembre». Cada marca tiene sus propios colores, tipografías y formas, y por eso el resultado sale distinto. Míralo antes de creerlo.</p>
      <div className="mv2-seg" role="group" aria-label="Formato">
        <button type="button" className={fmt === "post" ? "on" : ""} aria-pressed={fmt === "post"} onClick={() => setFmt("post")}>Post 1080 × 1080</button>
        <button type="button" className={fmt === "story" ? "on" : ""} aria-pressed={fmt === "story"} onClick={() => setFmt("story")}>Story 1080 × 1920</button>
      </div>
      <div className={`mv2-gal mv2-gal--${fmt}`}>
        {GALLERY.map((b) => (
          <figure key={b.id}>
            <div className="mv2-gal-img">
              <img src={`/landing/ejemplos/${b.id}-${fmt}.webp`} alt={b.alt} width={fmt === "post" ? 720 : 540} height={fmt === "post" ? 720 : 960} loading="lazy" decoding="async" />
            </div>
            <figcaption>
              <b>{b.name}</b>
              <span>{b.kind}</span>
              <span className="mv2-gal-tok" data-no-i18n="">
                {b.colors.map((c) => <i key={c} style={{ background: c }} title={c} />)}
                <em>{b.font}</em>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mv2-note">Cómo se hicieron: Claude, conectado a Musa por MCP, recibió el brief y los colores y tipografías de cada marca, diseñó las seis piezas dentro del editor (de 15 a 20 capas editables cada una) y Musa las exportó. Nadie las retocó a mano. Las marcas son de ejemplo.</p>
    </section>
  );
}

/* ── Tu marca, no plantilla ── */
const PILLARS: [string, string, string][] = [
  ["Tus colores y tipografías, no inventados", "Salen de tu manual, tu logo o tu web. Tu IA no elige «un azul bonito»: usa el tuyo, con su código exacto.", ""],
  ["Tus reglas, revisadas antes de entregar", "Tu manual de marca vive en Musa. Antes de entregar, tu IA valida cada pieza contra tu marca —colores, tipografías, contraste— y corrige lo que se sale.", "alt"],
  ["Tus formatos como punto de partida", "Las plantillas de tu marca se vuelven la base. Cada pieza nueva parte de tu sistema, no de un catálogo que usan millones de cuentas.", ""],
];

export function BrandSection({ cmpHref }: { cmpHref: string }) {
  return (
    <section className="mv2-sec" id="tu-marca" aria-labelledby="mv2-brand-t">
      <h2 id="mv2-brand-t">Tu marca, <em>no una plantilla.</em></h2>
      <p>«Si todos conectan su IA a la misma herramienta, ¿no saldremos todos iguales?» No: la herramienta es la misma, el sistema es tuyo. Musa no trae un estilo propio; trae reglas, y las reglas salen de tu marca. Por eso las tres piezas de arriba no se parecen.</p>
      <div className="mv2-pillars">
        {PILLARS.map(([t, d, tone], i) => (
          <article key={t} className={`mv2-card ${tone}`}>
            <span className="tag">{`0${i + 1}`}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </article>
        ))}
      </div>
      <div className="mv2-vs">
        <p><b>Canva te da plantillas. Musa aprende el sistema de tu marca.</b></p>
        <p>Donde Canva gana: una biblioteca mucho más grande y casi nada que aprender. Si solo necesitas piezas sueltas rápido, te sirve. Si produces mucho para una o varias marcas y quieres que se vean como esas marcas, para eso está Musa.</p>
        <a className="chip" href={cmpHref}>Musa vs Canva, punto por punto</a>
      </div>
    </section>
  );
}

/* ── Para quién ── */
const WHO: [string, string, string][] = [
  ["Community managers", "Musa produce las variantes —formatos, marcas, idiomas— y tú te quedas con la estrategia. Todas tus marcas, sus calendarios y sus mensajes en un solo lugar.", "dark"],
  ["Agencias", "Más clientes con el mismo equipo: cada persona con su IA, el sistema de cada cliente cargado y un portal para que aprueben sin enlaces sueltos. Mejor margen por pieza.", "alt"],
  ["Diseñadores senior", "Musa es tu junior: delegas lo repetitivo y te quedas con la dirección creativa. Cada pieza queda en capas para que la toques a mano. ¿Escéptico? Mira primero los ejemplos.", ""],
  ["Negocios y emprendedores", "Clínicas, tiendas, logística: describes la idea y sale lista para publicar con los colores de tu negocio. Hay plan para una persona.", "dark"],
];

export function AudienceSection() {
  return (
    <section className="mv2-sec" id="para-quien" aria-labelledby="mv2-who-t">
      <h2 id="mv2-who-t">Para quién <em>es Musa</em></h2>
      <div className="mv2-who">
        {WHO.map(([t, d, tone]) => (
          <article key={t} className={`mv2-card ${tone}`}>
            <h3>{t}</h3>
            <p>{d}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Tu IA: para el comprador técnico ── */
const INFRA: [string, string][] = [
  ["Una herramienta en el flujo de tu agente", "Servidor MCP con llave por persona. No es otro chat: Claude, ChatGPT, Codex o Cursor lo llaman como a cualquier herramienta."],
  ["Lo que hace la pantalla, lo hace tu IA", "Cada acción de Musa es una herramienta MCP. Tu equipo y sus IAs trabajan sobre los mismos archivos, a la vez."],
  ["Exporta editable, no capturas", "PNG, SVG para Figma o Illustrator, PDF, video MP4, el código HTML/CSS de cada pieza y tus colores y tipografías en CSS o JSON."],
  ["Usa la IA que ya pagas", "Tu IA trabaja con su propia suscripción: Musa no te cobra sus tokens. Para generar imágenes dentro de Musa usas tu llave o los créditos del plan."],
];

export function InfraSection() {
  return (
    <section className="mv2-sec" id="tu-ia" aria-labelledby="mv2-ia-t">
      <h2 id="mv2-ia-t">Tu IA, <em>con herramientas de verdad</em></h2>
      <p>Para equipos técnicos: Musa es infraestructura, no un envoltorio de chat.</p>
      <div className="mv2-infra">
        {INFRA.map(([t, d]) => (
          <article key={t}>
            <b>{t}</b>
            <span>{d}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Preguntas frecuentes (precio primero) ── */
function faqs(data: PlansData | null): [string, string][] {
  const cre = plan(data, "creador", "byok");
  const creIa = plan(data, "creador", "musa_ia");
  const age = plan(data, "agencia", "byok");
  const emp = plan(data, "empresa", "musa_ia");
  const price = cre && age && emp
    ? `Creador (1 persona) desde ${usd(cre.price_usd)} al mes, con los primeros ${cre.intro_months || 3} meses a ${usd(cre.intro_price_usd ?? cre.price_usd)}; Agencia (${age.seats} personas) desde ${usd(age.price_usd)}; Empresa ${usd(emp.price_usd)}. En soles, Creador sale ${pen(cre.price_usd)} al mes. El plan anual trae 2 meses gratis y todos los precios están publicados en Planes.`
    : "Todos los precios están publicados en Planes: Creador para una persona, Agencia para equipos y Empresa para varias áreas. El plan anual trae 2 meses gratis.";
  return [
    ["¿Cuánto cuesta Musa?", price],
    ["Ya pago Claude Pro o ChatGPT Plus. ¿Tengo que pagar IA aparte?", "No para diseñar. Tu IA se conecta a Musa por MCP y trabaja con la suscripción que ya pagas: Musa no te cobra por esos tokens. Solo si quieres generar imágenes dentro de Musa necesitas tu propia llave de API o el plan con IA de Musa."],
    ["¿Musa trae su propio modelo de IA?", creIa
      ? `No. Musa es la plataforma donde trabaja la IA que ya usas (Claude, ChatGPT, Codex, Cursor, Gemini y otras con MCP). El modo «Con IA de Musa» (desde ${usd(creIa.price_usd)} al mes en Creador) suma créditos para generar imágenes y textos dentro de la app sin configurar nada.`
      : "No. Musa es la plataforma donde trabaja la IA que ya usas (Claude, ChatGPT, Codex, Cursor, Gemini y otras con MCP). El modo «Con IA de Musa» suma créditos para generar imágenes y textos dentro de la app sin configurar nada."],
    ["¿Mis piezas se van a ver genéricas, «hechas con IA»?", "No, porque Musa no trae estilo propio. Tu IA diseña con los colores, tipografías, plantillas y reglas de tu marca, y valida cada pieza contra tu marca antes de entregarla. Mira en los ejemplos el mismo brief en tres marcas."],
    ["¿En qué se diferencia de Canva?", "Canva parte de un catálogo de plantillas; Musa parte del sistema de tu marca. Además tu IA opera Musa completo por MCP, cada pieza es código editable y en la misma plataforma tienes calendario, bandeja, pauta y CRM. Canva gana en tamaño de biblioteca y facilidad para piezas sueltas."],
    ["¿Quién está detrás de Musa?", "Musa es un producto de Futuraria. Detrás hay un equipo de personas, no solo un bot: escríbenos a soporte@futuraria.com y te responde alguien del equipo."],
    ["¿Cuánto toma empezar?", "Creas tu cuenta, eliges tu plan y conectas tu IA pegando una llave. No hay nada que instalar y tu espacio ya trae ejemplos en cada módulo para ver cómo se vería tu marca."],
    ["¿Puedo editar y exportar lo que hace la IA?", "Sí. Cada pieza queda como un diseño con capas que puedes tocar a mano o pedirle cambios a tu IA. Exportas PNG, SVG, PDF, video MP4, el código HTML/CSS y tus colores y tipografías en CSS o JSON."],
    ["¿Sirve para mi equipo o mi agencia?", age
      ? `Sí. Cada persona tiene su llave y su IA, y todos trabajan sobre las mismas marcas a la vez. Agencia incluye ${age.seats} personas, ${age.brands == null ? "marcas ilimitadas" : `${age.brands} marcas`} y un portal para tus clientes; las personas extra se suman por mes.`
      : "Sí. Cada persona tiene su llave y su IA, y todos trabajan sobre las mismas marcas a la vez. El plan Agencia incluye un portal para tus clientes y las personas extra se suman por mes."],
  ];
}

export function FaqSection({ data }: { data: PlansData | null }) {
  const list = useMemo(() => faqs(data), [data]);
  const jsonLd = useMemo(() => JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: list.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  }), [list]);
  return (
    <section className="mv2-sec" id="preguntas" aria-labelledby="mv2-faq-t">
      <h2 id="mv2-faq-t">Antes de <em>empezar</em></h2>
      <div className="mv2-faq">
        {list.map(([q, a], i) => (
          <details key={q} open={i < 2}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
      <ul className="mv2-trust">
        <li><b>Precio a la vista.</b> <button type="button" onClick={() => go("planes")}>Ver todos los planes</button></li>
        <li><b>Nada que instalar.</b> Cuenta, plan y una llave para tu IA.</li>
        <li><b>Personas detrás.</b> <a href="mailto:soporte@futuraria.com">soporte@futuraria.com</a></li>
      </ul>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </section>
  );
}

