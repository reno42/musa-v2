const MIN_FRAMES = 2;
const MAX_FRAMES = 40;
const MAX_DIMENSION = 10000;

function invalid(message) {
  const error = new Error(message);
  error.code = -32602;
  return error;
}

function substantial(value, minimum) {
  return typeof value === "string" && value.trim().length >= minimum;
}

export function buildHtmlCarousel(params, createFrameId) {
  const workspaceId = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : "";
  const name = typeof params?.name === "string" ? params.name.trim() : "";
  const width = Number(params?.width);
  const height = Number(params?.height);
  const sourceFrames = params?.frames;

  if (!workspaceId) throw invalid("create_html_carousel requires workspaceId");
  if (!name) throw invalid("create_html_carousel requires a non-empty name");
  if (!Number.isFinite(width) || width < 1 || width > MAX_DIMENSION) {
    throw invalid("create_html_carousel width must be between 1 and 10000");
  }
  if (!Number.isFinite(height) || height < 1 || height > MAX_DIMENSION) {
    throw invalid("create_html_carousel height must be between 1 and 10000");
  }
  if (!Array.isArray(sourceFrames) || sourceFrames.length < MIN_FRAMES || sourceFrames.length > MAX_FRAMES) {
    throw invalid(`create_html_carousel requires between ${MIN_FRAMES} and ${MAX_FRAMES} frames`);
  }
  if (typeof createFrameId !== "function") throw new TypeError("createFrameId must be a function");

  const frames = sourceFrames.map((frame, index) => {
    const frameName = typeof frame?.name === "string" ? frame.name.trim() : "";
    if (!frameName) throw invalid(`create_html_carousel frame ${index + 1} requires a non-empty name`);
    if (!substantial(frame?.html, 40)) {
      throw invalid(`create_html_carousel frame ${index + 1} html must contain at least 40 characters`);
    }
    if (!substantial(frame?.css, 20)) {
      throw invalid(`create_html_carousel frame ${index + 1} css must contain at least 20 characters`);
    }
    return {
      id: createFrameId(),
      name: frameName,
      x: index * width,
      y: 0,
      width,
      height,
      html: frame.html,
      css: frame.css,
      background: "#ffffff",
    };
  });

  return {
    workspaceId,
    name,
    width,
    height,
    brandId: typeof params.brandId === "string" && params.brandId.trim() ? params.brandId.trim() : null,
    frames,
  };
}
