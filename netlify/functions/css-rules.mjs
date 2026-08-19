/**
 * Setting one declaration inside a stylesheet, safely.
 *
 * Extracted because the fiddly parts are easy to get wrong twice: matching
 * `left` inside `border-left`, and swallowing the `;` that ended the previous
 * declaration when replacing one. Both were real bugs.
 */

const escapeForRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sets a property on the rule for `selector`, creating the rule if it has none.
 *
 * `extraOnCreate` is written only when the rule is new — a position that the
 * property needs to take effect, say.
 */
export function setCssDeclaration(css, selector, property, value, extraOnCreate = "") {
  const sheet = css || "";
  const escaped = escapeForRegExp(selector);
  const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
  const rule = ruleRe.exec(sheet);

  if (!rule) {
    const extra = extraOnCreate ? `  ${extraOnCreate}\n` : "";
    return `${sheet}\n${selector} {\n${extra}  ${property}: ${value};\n}`;
  }

  let declarations = rule[2];
  // The boundary is required so `border-color` is not found inside
  // `-webkit-border-color`, and captured so the `;` that closed the previous
  // declaration survives the rewrite.
  const propRe = new RegExp(`(^|[;{\\s])${escapeForRegExp(property)}\\s*:[^;]*;?`);
  declarations = propRe.test(declarations)
    ? declarations.replace(propRe, (_m, boundary) => `${boundary}\n  ${property}: ${value};`)
    : `${declarations.trimEnd()}\n  ${property}: ${value};\n`;

  // A function replacer, so a `$&` or `$1` inside a declaration — a url(), for
  // instance — is not re-read as a substitution pattern.
  return sheet.replace(ruleRe, () => `${rule[1]}${declarations}${rule[3]}`);
}

/**
 * Removes properties from the rule for `selector`; a rule left with no
 * declarations is dropped entirely. Counterpart of setCssDeclaration for the
 * mask bake, which clears every stale clip/mask declaration before writing
 * the fresh one.
 */
export function removeCssDeclarations(css, selector, properties) {
  const props = Array.isArray(properties) ? properties : [properties];
  const sheet = css || "";
  const escaped = escapeForRegExp(selector);
  const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
  const rule = ruleRe.exec(sheet);
  if (!rule) return sheet;

  let declarations = rule[2];
  for (const property of props) {
    const propRe = new RegExp(`(^|[;{\\s])${escapeForRegExp(property)}\\s*:[^;]*;?\\s*`, "g");
    declarations = declarations.replace(propRe, (_m, boundary) => boundary === "{" ? "{" : "");
  }

  // Dropping every declaration drops the rule — an empty husk would win the
  // cascade over nothing and confuse the next reader.
  if (!declarations.replace(/\s/g, "").replace(/\{/, "").trim()) {
    return sheet.replace(ruleRe, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  }
  return sheet.replace(ruleRe, () => `${rule[1]}${declarations}${rule[3]}`);
}

/** Reads a property off the rule for `selector`, or "" when it is not set. */
export function readCssDeclaration(css, selector, property) {
  const escaped = escapeForRegExp(selector);
  const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css || "");
  if (!rule) return "";
  const hit = new RegExp(`(?:^|[;{\\s])${escapeForRegExp(property)}\\s*:\\s*([^;]+)`).exec(rule[1]);
  return hit ? hit[1].trim() : "";
}
