import type { ReactNode } from "react";

/**
 * Mini-renderizador de Markdown para las notas del Second Brain y las notas
 * internas del CRM. Sin dependencias: el paquete no trae react-markdown y no
 * vale la pena sumar un árbol por esto. Cubre el dialecto que un humano usa
 * al escribir un brief: encabezados #/##/###, negritas, cursivas, `código`,
 * bloques ``` ```, listas -/1., citas >, reglas ---, párrafos y enlaces.
 *
 * Todo el texto se renderiza como nodos React (nunca HTML crudo), así que no
 * hay superficie de XSS más allá de los enlaces, y esos se filtran por
 * esquema: solo http(s), obsidian:// y mailto: se vuelven <a>.
 */

const SAFE_URL = /^(https?:\/\/|obsidian:\/\/|mailto:)/i;

function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : null;
}

/** Negrita, cursiva, código y [texto](url) en una sola pasada. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g);
  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      return href
        ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{link[1]}</a>
        : <span key={key}>{link[1]}</span>;
    }
    return <span key={key}>{part}</span>;
  });
}

/** Convierte Markdown plano a nodos React. Entrada vacía → lista vacía. */
export function renderMarkdown(source: string | null | undefined): ReactNode {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) { code.push(lines[index]); index += 1; }
      index += 1; // fence de cierre (o fin de texto)
      blocks.push(<pre key={key++}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    if (!line.trim()) { index += 1; continue; }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h${key}`);
      blocks.push(level === 1 ? <h3 key={key++}>{content}</h3> : level === 2 ? <h4 key={key++}>{content}</h4> : <h5 key={key++}>{content}</h5>);
      index += 1;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { blocks.push(<hr key={key++} />); index += 1; continue; }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(<li key={items.length}>{inline(lines[index].replace(/^\s*[-*]\s+/, ""), `li${key}-${items.length}`)}</li>);
        index += 1;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(<li key={items.length}>{inline(lines[index].replace(/^\s*\d+[.)]\s+/, ""), `ol${key}-${items.length}`)}</li>);
        index += 1;
      }
      blocks.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) { quote.push(lines[index].replace(/^\s*>\s?/, "")); index += 1; }
      blocks.push(<blockquote key={key++}>{inline(quote.join(" "), `bq${key}`)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+[.)]\s|\s*>)/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) blocks.push(<p key={key++}>{inline(paragraph.join(" "), `p${key}`)}</p>);
  }

  return blocks;
}
