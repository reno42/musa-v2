/** Legal documents for the SaaS landing: Términos, Privacidad y Cookies.
 *
 *  Drafted in Spanish following the skeleton of the standard YC-style SaaS
 *  agreement (acceptance → service → accounts → use → IP → payments → AI
 *  third parties → liability → law). Self-contained portal modal so any
 *  footer can open it without touching global CSS. Content is plain data:
 *  editing a clause never means touching layout code.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";

export type LegalDoc = "terminos" | "privacidad" | "cookies";

interface Section {
  h: string;
  p: string[];
}

/** Soporte legal: el mismo buzón que ya usa la landing para contacto. */
const LEGAL_EMAIL = "soporte@futuraria.com";

const DOCS: Record<LegalDoc, { title: string; updated: string; intro: string; sections: Section[] }> = {
  terminos: {
    title: "Términos y Condiciones",
    updated: "12 de septiembre de 2026",
    intro:
      "Estos Términos regulan el uso de Musa, el workspace de diseño operado por Futuraria. Al crear una cuenta o usar el servicio, aceptas este acuerdo — el mismo tipo de contrato que usan las empresas SaaS serias, escrito en claro.",
    sections: [
      {
        h: "1. El servicio",
        p: [
          "Musa es una plataforma de diseño donde puedes crear, editar y publicar piezas visuales (posts, banners, decks y otros activos) tú mismo o junto a agentes de IA conectados vía MCP. El servicio incluye el editor, el sistema de plantillas, el grafo de diseño y las integraciones que se indiquen en la documentación.",
          "Mejoramos el servicio de forma continua: podemos añadir, modificar o retirar funciones. Si un cambio reduce de forma material algo que hayas pagado, te avisaremos con antelación razonable.",
        ],
      },
      {
        h: "2. Cuenta y elegibilidad",
        p: [
          "Para usar Musa necesitas una cuenta con datos veraces y actualizados. Debes ser mayor de edad o contar con autorización de tu representante legal. Eres responsable de mantener la confidencialidad de tus credenciales y de toda actividad que ocurra en tu cuenta; avísanos de inmediato ante cualquier uso no autorizado.",
          "Los espacios de trabajo de equipo dependen de los roles que configures: invitaste al agente, el agente entra. Revisa a quién das acceso.",
        ],
      },
      {
        h: "3. Uso aceptable",
        p: [
          "No puedes usar el servicio para: infringir derechos de terceros (incluidos copyright, marca y derecho a la propia imagen); distribuir malware; realizar ingeniería inversa del servicio salvo lo permitido por la ley; saltarte límites técnicos o tasas de uso; suplantar identidades; ni crear contenido ilegal, engañoso o dañino.",
          "Podemos suspender cuentas que incumplan estas reglas, con aviso cuando sea posible. En lo demás, tu workspace es tuyo y no lo revisamos salvo por seguridad, soporte solicitado o requerimiento legal.",
        ],
      },
      {
        h: "4. Tu contenido",
        p: [
          "Los diseños, textos, imágenes y datos que subas siguen siendo tuyos. Nos concedes únicamente la licencia limitada necesaria para operar el servicio: almacenarlos, mostrarlos, procesarlos (incluidas las funciones de IA que invoques) y hacer copias de seguridad. Nada más.",
          "Eres responsable de tener derechos sobre lo que subes. Si tu contenido genera una reclamación de terceros por infracción, tú respondes frente a ellos y nos mantienes indeminne según la cláusula 8.",
        ],
      },
      {
        h: "5. Nuestra propiedad intelectual",
        p: [
          "El software, la marca Musa, las plantillas nativas, la documentación y las interfaces del servicio pertenecen a Futuraria. Recibes un derecho de uso revocable mientras cumplas estos Términos; no te transfieren propiedad ni licencias sobre el código fuente.",
        ],
      },
      {
        h: "6. Planes, pagos y renovación",
        p: [
          "Los planes de pago se cobran por adelantado según el ciclo (mensual o anual) e incluyen los impuestos aplicables cuando la ley lo exija. La suscripción se renueva automáticamente salvo cancelación previa desde la configuración de la cuenta; al cancelar conservas el acceso hasta el final del período ya pagado.",
          "Los reembolsos se rigen por la política publicada en cada plan y por el derecho de desistimiento que corresponda según tu jurisdicción.",
        ],
      },
      {
        h: "7. Funciones de IA y servicios de terceros",
        p: [
          "Las funciones de IA se apoyan en proveedores externos (como OpenAI, Anthropic o Google). Cuando generes contenido con IA, el resultado puede contener errores o inexactitudes: revísalo antes de publicarlo. Tú decides qué contexto envías a cada proveedor, y nuestras políticas no usan tu contenido para entrenar modelos de terceros.",
          "Las integraciones con servicios de terceros (Supabase, pasarelas de pago, herramientas conectadas) se rigen además por sus propios términos. No respondemos por servicios de terceros, y si un proveedor externo cambia o falla, comunicaremos alternativas.",
        ],
      },
      {
        h: "8. Indemnización",
        p: [
          "Aceptas indemnizarnos frente a reclamaciones de terceros que surjan de tu contenido, de tu uso del servicio en contra de estos Términos o de tu incumplimiento de la ley, en la medida en que dicha reclamación no sea imputable a Futuraria.",
        ],
      },
      {
        h: "9. Exención de garantías y limitación de responsabilidad",
        p: [
          "El servicio se ofrece «tal cual» y «según disponibilidad», sin garantías implícitas de comerciabilidad o aptitud para un fin particular, en la máxima medida permitida por la ley.",
          "Salvo dolo o culpa grave, la responsabilidad total de Futuraria por cualquier reclamación se limita al importe que hayas pagado en los doce meses anteriores, y excluye daños indirectos o lucro cesante. Nada de esto limita responsabilidad que la ley no permita limitar, incluida la frente a consumidores.",
        ],
      },
      {
        h: "10. Terminación",
        p: [
          "Puedes cerrar tu cuenta cuando quieras. Podemos suspender o terminar cuentas en caso de impago persistente o incumplimiento grave de estos Términos. Antes de la eliminación definitiva te daremos, cuando sea razonable, la oportunidad de exportar tus diseños.",
        ],
      },
      {
        h: "11. Cambios y ley aplicable",
        p: [
          "Podemos actualizar estos Términos; publicaremos la versión vigente con su fecha y avisaremos de los cambios materiales. Seguir usando el servicio tras el aviso implica aceptarlos.",
          "Este acuerdo se rige por las leyes aplicables en el domicilio fiscal de Futuraria, sin perjuicio de los derechos imperativos que correspondan a consumidores según su legislación local. Dudas legales: " + LEGAL_EMAIL + ".",
        ],
      },
    ],
  },
  privacidad: {
    title: "Política de Privacidad",
    updated: "12 de septiembre de 2026",
    intro:
      "Esta Política explica qué datos tratamos en Musa, para qué, con quién los compartimos y cómo ejercer tus derechos. La regla de oro: tu data vive en tu cuenta, no la vendemos y no la usamos para entrenar modelos de terceros.",
    sections: [
      {
        h: "1. Responsable del tratamiento",
        p: [
          "Futuraria, operador de Musa. Contacto de privacidad: " + LEGAL_EMAIL + ".",
        ],
      },
      {
        h: "2. Qué datos tratamos",
        p: [
          "Datos de cuenta: nombre, correo electrónico, empresa y credenciales de acceso. Datos de contenido: los diseños, textos, briefs, marcas y contactos que creas o importas en tu workspace. Datos de uso: registros técnicos (dispositivo, navegador, sesiones, errores) necesarios para operar y asegurar el servicio.",
          "Datos de pago son tratados por la pasarela correspondiente; nosotros solo conservamos referencias y estado de la suscripción, nunca números completos de tarjeta.",
        ],
      },
      {
        h: "3. Para qué los usamos",
        p: [
          "Prestar el servicio (guardar y renderizar tus diseños), permitir que tus agentes de IA conectados trabajen con tu contexto, dar soporte, prevenir abusos, facturar y comunicar novedades operativas. Te escribimos por marketing solo con tu consentimiento y puedes darte de baja en un clic.",
        ],
      },
      {
        h: "4. Con quién los compartimos",
        p: [
          "Proveedores encargados que operan bajo contrato: alojamiento y base de datos (Supabase), proveedores de IA (OpenAI, Anthropic, Google u otros que elijas al conectar tu agente) y la pasarela de pagos. Solo les enviamos lo mínimo necesario para la función que invocas.",
          "No vendemos datos personales. No los compartimos con terceros con fines publicitarios. Solo los revelamos ante requerimiento legal válido o para proteger derechos e integridad del servicio.",
        ],
      },
      {
        h: "5. Tus derechos",
        p: [
          "Puedes acceder, rectificar, exportar y eliminar tus datos, y retirar consentimientos otorgados, desde la configuración de tu cuenta o escribiendo a " + LEGAL_EMAIL + ". Atendemos las solicitudes en el plazo legal aplicable. Si estás en el EEE o el Reino Unido, dispones además de los derechos y vías de reclamación que otorga el GDPR.",
        ],
      },
      {
        h: "6. Conservación y seguridad",
        p: [
          "Conservamos tu contenido mientras tu cuenta esté activa; tras eliminarla, lo purgamos de forma definitiva tras un período de gracia razonable para recuperación ante errores, salvo obligación legal de retención. Aplicamos cifrado en tránsito y en reposo, control de acceso por roles y registro de auditoría de las acciones sensibles.",
        ],
      },
      {
        h: "7. Menores y cambios",
        p: [
          "El servicio no está dirigido a menores de 16 años; si detectamos una cuenta de un menor, la eliminamos. Publicamos aquí cada cambio de esta Política con su fecha; los cambios materiales se avisarán dentro del producto.",
        ],
      },
    ],
  },
  cookies: {
    title: "Política de Cookies",
    updated: "12 de septiembre de 2026",
    intro:
      "Usamos la mínima cantidad de cookies posible: las que hacen que la sesión y el editor funcionen, y las que recuerdan tus preferencias. Ni publicidad, ni rastreadores de terceros.",
    sections: [
      {
        h: "1. Qué son",
        p: [
          "Las cookies son pequeños archivos que el sitio guarda en tu navegador. También usamos equivalents como localStorage para el mismo fin; cuando decimos «cookies» nos referimos a ambos.",
        ],
      },
      {
        h: "2. Qué cookies usamos",
        p: [
          "Estrictamente necesarias: sesión y autenticación (mantener tu cuenta abierta de forma segura), protección CSRF y balanza de carga. Sin ellas el producto no funciona.",
          "Preferencias: recordar tu workspace activo, el ancho de paneles del editor y otros ajustes de interfaz que tú mismo configuras.",
          "No usamos cookies de publicidad, ni de perfilamiento publicitario, ni venta de datos a brokers.",
        ],
      },
      {
        h: "3. Tabla resumen",
        p: [
          "auth/session — necesaria — mantener tu sesión iniciada. workspace/context — preferencia — recordar el workspace y la vista activa. ui/preferences — preferencia — paneles, tema y ajustes del editor. error/diagnostics — necesaria — diagnóstico técnico anónimo de fallos.",
        ],
      },
      {
        h: "4. Cómo gestionarlas",
        p: [
          "Puedes borrar o bloquear cookies desde la configuración de tu navegador; las necesarias pueden impedir iniciar sesión si se bloquean. Como no usamos cookies de terceros con fines de seguimiento, no hay panel de consentimiento publicitario que gestionar.",
        ],
      },
      {
        h: "5. Cambios",
        p: [
          "Actualizaremos esta Política si cambia el uso de cookies, indicando la fecha de revisión arriba. Dudas: " + LEGAL_EMAIL + ".",
        ],
      },
    ],
  },
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(5,5,10,0.7)",
  backdropFilter: "blur(6px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
};

const panelStyle: React.CSSProperties = {
  width: "min(720px, 100%)",
  maxHeight: "86vh",
  display: "flex",
  flexDirection: "column",
  background: "linear-gradient(160deg, rgba(22,22,32,0.98), rgba(14,14,20,0.98))",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 18,
  boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
  color: "rgba(255,255,255,0.82)",
  fontFamily: "inherit",
  overflow: "hidden",
};

const TABS: Array<{ id: LegalDoc; label: string }> = [
  { id: "terminos", label: "Términos" },
  { id: "privacidad", label: "Privacidad" },
  { id: "cookies", label: "Cookies" },
];

export function LegalModal({ doc, onNavigate, onClose }: { doc: LegalDoc; onNavigate: (doc: LegalDoc) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const current = DOCS[doc];

  return createPortal(
    <div style={overlayStyle} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label={current.title}>
      <div style={panelStyle}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <nav style={{ display: "flex", gap: 6 }} aria-label="Documentos legales">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: `1px solid ${tab.id === doc ? "rgba(167,139,250,0.55)" : "rgba(255,255,255,0.1)"}`,
                  background: tab.id === doc ? "rgba(167,139,250,0.16)" : "transparent",
                  color: tab.id === doc ? "rgba(216,203,255,0.95)" : "rgba(255,255,255,0.6)",
                  font: "inherit",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", fontSize: 22, lineHeight: 1, cursor: "pointer", padding: 4 }}>×</button>
        </header>
        <div style={{ overflowY: "auto", padding: "20px 26px 30px" }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 600, color: "#fff", fontFamily: "inherit" }}>{current.title}</h2>
          <p style={{ margin: "0 0 14px", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>Última actualización: {current.updated}</p>
          <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.65, color: "rgba(255,255,255,0.72)" }}>{current.intro}</p>
          {current.sections.map((section) => (
            <section key={section.h} style={{ marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600, color: "rgba(216,203,255,0.95)" }}>{section.h}</h3>
              {section.p.map((paragraph, index) => (
                <p key={index} style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.7, color: "rgba(255,255,255,0.68)" }}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
