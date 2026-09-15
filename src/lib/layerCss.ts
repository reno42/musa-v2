/** Returns the inline and stylesheet declarations that apply to one element. */
export function elementCssDeclarations(element: Element, css: string): string {
  const declarations = [element.getAttribute("style") || ""];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(css || ""))) {
    const selectorList = match[1].trim();
    if (!selectorList || selectorList.startsWith("@")) continue;
    const applies = selectorList.split(",").some(selector => {
      try {
        return element.matches(selector.trim());
      } catch {
        return false;
      }
    });
    if (applies) declarations.push(match[2]);
  }

  return declarations.filter(Boolean).join(";");
}
