function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function brandCssMarker(brandId) {
  return `futuraria-brand:${brandId}`;
}

export function applyBrandCss(css, brandId, sharedCss) {
  const cleanBrandId = typeof brandId === "string" ? brandId.trim() : "";
  const cleanSharedCss = typeof sharedCss === "string" ? sharedCss.trim() : "";
  if (!cleanBrandId) throw new Error("Brand CSS application requires brandId");
  if (!cleanSharedCss) throw new Error(`Brand ${cleanBrandId} has no sharedCss to apply`);
  const start = `/* ${brandCssMarker(cleanBrandId)}:start */`;
  const end = `/* ${brandCssMarker(cleanBrandId)}:end */`;
  const block = `${start}\n${cleanSharedCss}\n${end}`;
  const current = typeof css === "string" ? css : "";
  const existing = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "g");
  if (existing.test(current)) return current.replace(existing, block);
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}`;
}

export function applyBrandCssToFrames(frames, brandId, sharedCss) {
  return (Array.isArray(frames) ? frames : []).map(frame => ({
    ...frame,
    css: applyBrandCss(frame?.css || "", brandId, sharedCss),
  }));
}
