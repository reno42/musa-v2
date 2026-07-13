export interface CssDeclaration {
  property: string;
  value: string;
  start: number;
  end: number;
}

interface CssRule {
  start: number;
  blockStart: number;
  blockEnd: number;
  end: number;
  selectors: string[];
}

function skipQuoted(css: string, index: number): number {
  const quote = css[index];
  for (let i = index + 1; i < css.length; i++) {
    if (css[i] === "\\") i++;
    else if (css[i] === quote) return i;
  }
  return css.length - 1;
}

function skipComment(css: string, index: number): number {
  const end = css.indexOf("*/", index + 2);
  return end === -1 ? css.length - 1 : end + 1;
}

function findClosingBrace(css: string, openIndex: number, limit = css.length): number {
  let depth = 1;
  for (let i = openIndex + 1; i < limit; i++) {
    if (css[i] === "'" || css[i] === '"') i = skipQuoted(css, i);
    else if (css[i] === "/" && css[i + 1] === "*") i = skipComment(css, i);
    else if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return limit - 1;
}

function splitSelectors(header: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < header.length; i++) {
    if (header[i] === "'" || header[i] === '"') i = skipQuoted(header, i);
    else if (header[i] === "(" || header[i] === "[") depth++;
    else if (header[i] === ")" || header[i] === "]") depth--;
    else if (header[i] === "," && depth === 0) {
      selectors.push(header.slice(start, i).trim());
      start = i + 1;
    }
  }
  selectors.push(header.slice(start).trim());
  return selectors.filter(Boolean);
}

function collectRules(css: string, start = 0, end = css.length): CssRule[] {
  const rules: CssRule[] = [];
  let statementStart = start;

  for (let i = start; i < end; i++) {
    if (css[i] === "'" || css[i] === '"') {
      i = skipQuoted(css, i);
      continue;
    }
    if (css[i] === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
      continue;
    }
    if (css[i] === ";") {
      statementStart = i + 1;
      continue;
    }
    if (css[i] !== "{") continue;

    const blockEnd = findClosingBrace(css, i, end);
    const rawHeader = css.slice(statementStart, i);
    const header = rawHeader.replace(/^(?:\s|\/\*[\s\S]*?\*\/)+/, "").trim();
    const headerOffset = rawHeader.lastIndexOf(header);
    const ruleStart = headerOffset >= 0 ? statementStart + headerOffset : statementStart;

    if (/^@(media|supports|container|layer|scope|document)\b/i.test(header)) {
      rules.push(...collectRules(css, i + 1, blockEnd));
    } else if (!header.startsWith("@")) {
      rules.push({
        start: ruleStart,
        blockStart: i + 1,
        blockEnd,
        end: blockEnd + 1,
        selectors: splitSelectors(header),
      });
    }

    i = blockEnd;
    statementStart = blockEnd + 1;
  }
  return rules;
}

function findDeclarationColon(segment: string): number {
  let depth = 0;
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === "'" || segment[i] === '"') i = skipQuoted(segment, i);
    else if (segment[i] === "/" && segment[i + 1] === "*") i = skipComment(segment, i);
    else if (segment[i] === "(") depth++;
    else if (segment[i] === ")") depth--;
    else if (segment[i] === ":" && depth === 0) return i;
  }
  return -1;
}

export function parseCssDeclarations(block: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  let start = 0;
  let depth = 0;

  const addSegment = (end: number) => {
    const segment = block.slice(start, end);
    const colon = findDeclarationColon(segment);
    if (colon > -1) {
      const property = segment.slice(0, colon).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const value = segment.slice(colon + 1).trim();
      if (property && value && !property.includes("{")) {
        declarations.push({ property, value, start, end });
      }
    }
  };

  for (let i = 0; i < block.length; i++) {
    if (block[i] === "'" || block[i] === '"') i = skipQuoted(block, i);
    else if (block[i] === "/" && block[i + 1] === "*") i = skipComment(block, i);
    else if (block[i] === "(") depth++;
    else if (block[i] === ")") depth--;
    else if (block[i] === ";" && depth === 0) {
      addSegment(i);
      start = i + 1;
    }
  }
  addSegment(block.length);
  return declarations;
}

function exactRule(rules: CssRule[], selector: string): CssRule | undefined {
  return [...rules].reverse().find(rule => rule.selectors.length === 1 && rule.selectors[0] === selector);
}

function layerIdFromSelector(selector: string): string | null {
  return /^\[data-layer-id=["']([^"']+)["']\]$/.exec(selector)?.[1] || null;
}

function setDeclaration(block: string, property: string, value: string): string {
  const matches = parseCssDeclarations(block).filter(decl => decl.property.toLowerCase() === property.toLowerCase());
  const match = matches[matches.length - 1];
  if (!match) return block.trimEnd() + `\n  ${property}: ${value};\n`;

  const original = block.slice(match.start, match.end);
  const indentation = original.match(/^\s*/)?.[0] || "";
  return block.slice(0, match.start) + `${indentation}${property}: ${value}` + block.slice(match.end);
}

function removeDeclaration(block: string, property: string): string {
  const matches = parseCssDeclarations(block)
    .filter(decl => decl.property.toLowerCase() === property.toLowerCase())
    .reverse();
  let updated = block;
  for (const match of matches) {
    let end = match.end;
    if (updated[end] === ";") end++;
    updated = updated.slice(0, match.start) + updated.slice(end);
  }
  return updated;
}

export function updateCssProperty(css: string, selector: string, property: string, value: string): string {
  const rule = exactRule(collectRules(css), selector);
  if (!rule) return css.trimEnd() + `\n\n${selector} {\n  ${property}: ${value};\n}`;

  const block = css.slice(rule.blockStart, rule.blockEnd);
  const updatedBlock = setDeclaration(block, property, value);
  return css.slice(0, rule.blockStart) + updatedBlock + css.slice(rule.blockEnd);
}

export function updateCssProperties(css: string, selector: string, properties: Record<string, string>): string {
  let updated = css;
  for (const [property, value] of Object.entries(properties)) {
    updated = updateCssProperty(updated, selector, property, value);
  }
  return updated;
}

export function appendCssOverride(css: string, selector: string, property: string, value: string): string {
  return css.trimEnd() + `\n\n${selector} {\n  ${property}: ${value};\n}`;
}

export function removeCssOverride(css: string, selector: string, property: string, expectedValue: string): string {
  const rules = collectRules(css);
  const candidates = rules.filter(rule => rule.selectors.length === 1 && rule.selectors[0] === selector).reverse();
  const expected = expectedValue.replace(/\s+/g, " ").trim().toLowerCase();

  for (const rule of candidates) {
    const block = css.slice(rule.blockStart, rule.blockEnd);
    const declarations = parseCssDeclarations(block);
    const declaration = [...declarations].reverse().find(item =>
      item.property.toLowerCase() === property.toLowerCase() &&
      item.value.replace(/\s+/g, " ").trim().toLowerCase() === expected
    );
    if (!declaration) continue;

    if (declarations.length === 1) {
      return (css.slice(0, rule.start) + css.slice(rule.end)).replace(/\n{3,}/g, "\n\n").trimEnd();
    }
    const updatedBlock = removeDeclaration(block, property);
    return css.slice(0, rule.blockStart) + updatedBlock + css.slice(rule.blockEnd);
  }
  return css;
}

export function getCssPropertyValue(css: string, selector: string, property: string): string {
  let value = "";
  for (const rule of collectRules(css)) {
    if (!rule.selectors.includes(selector)) continue;
    const declarations = parseCssDeclarations(css.slice(rule.blockStart, rule.blockEnd));
    for (const declaration of declarations) {
      if (declaration.property.toLowerCase() === property.toLowerCase()) value = declaration.value;
    }
  }
  return value;
}

export function getLayerIdsWithDeclaration(css: string, property: string, expectedValue: string): Set<string> {
  const values = new Map<string, string>();
  for (const rule of collectRules(css)) {
    if (rule.selectors.length !== 1) continue;
    const layerId = layerIdFromSelector(rule.selectors[0]);
    if (!layerId) continue;
    const declarations = parseCssDeclarations(css.slice(rule.blockStart, rule.blockEnd));
    for (const declaration of declarations) {
      if (declaration.property.toLowerCase() === property.toLowerCase()) {
        values.set(layerId, declaration.value.replace(/\s*!important\s*$/i, "").trim().toLowerCase());
      }
    }
  }
  const expected = expectedValue.trim().toLowerCase();
  return new Set([...values].filter(([, value]) => value === expected).map(([id]) => id));
}

export function cloneLayerCss(css: string, idMap: Map<string, string>): string {
  const clones: string[] = [];
  for (const rule of collectRules(css)) {
    const block = css.slice(rule.blockStart, rule.blockEnd);
    for (const [oldId, newId] of idMap) {
      if (rule.selectors.some(selector => layerIdFromSelector(selector) === oldId)) {
        clones.push(`[data-layer-id="${newId}"] {${block}}`);
      }
    }
  }
  return clones.length ? css.trimEnd() + "\n\n" + clones.join("\n\n") : css;
}

export function removeLayerCss(css: string, layerId: string): string {
  let updated = css;
  for (const rule of collectRules(css).filter(item => item.selectors.some(selector => layerIdFromSelector(selector) === layerId)).reverse()) {
    if (rule.selectors.length === 1) {
      updated = updated.slice(0, rule.start) + updated.slice(rule.end);
    } else {
      const remainingSelectors = rule.selectors.filter(selector => layerIdFromSelector(selector) !== layerId).join(", ");
      updated = updated.slice(0, rule.start) + remainingSelectors + " " + updated.slice(rule.blockStart - 1);
    }
  }
  return updated.replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function filterCssDeclarations(block: string, excludedProperties: Set<string>): string {
  return parseCssDeclarations(block)
    .filter(declaration => !excludedProperties.has(declaration.property.toLowerCase()))
    .map(declaration => `${declaration.property}: ${declaration.value};`)
    .join("\n  ");
}

export function getExactRuleDeclarations(css: string, selector: string): string {
  const rule = exactRule(collectRules(css), selector);
  return rule ? css.slice(rule.blockStart, rule.blockEnd) : "";
}

export function setTransformFunction(transform: string | undefined, name: string, value: string): string {
  const base = transform && transform.trim() !== "none" ? transform.trim() : "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutFunction = base.replace(new RegExp(`${escapedName}\\([^)]+\\)\\s*`, "gi"), "").trim();
  return `${withoutFunction} ${name}(${value})`.trim();
}

export function removeTransformFunction(transform: string | undefined, name: string): string {
  const base = transform && transform.trim() !== "none" ? transform.trim() : "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return base.replace(new RegExp(`${escapedName}\\([^)]+\\)\\s*`, "gi"), "").trim();
}
