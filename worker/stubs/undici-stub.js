// Stub: undici innecesario en Workers (fetch nativo). cheerio lo importaba por node-shim.
const noop = () => { throw new Error("undici unavailable in Workers - use native fetch"); };
export const fetch = globalThis.fetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export default { fetch, Headers, Request, Response, FormData };
