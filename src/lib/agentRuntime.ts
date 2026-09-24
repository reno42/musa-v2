export const MAX_SUBAGENT_ROUNDS = 15;
export const DEEPSEEK_MAX_TOOLS = 128;
export const FREE_STYLE_SENTINEL = "__free_style__";

/** Maximum output tokens per LLM call. DeepSeek V4 Pro can emit up to 8192
 *  tokens; large multi-frame design generation (5+ frames of HTML/CSS) can
 *  easily exceed 4096. */
export const LLM_MAX_TOKENS = 8192;

/** Presupuesto de las decisiones del ghost brain (ghostBrain.decide vía
 *  llmJson): un veredicto JSON mecánico gasta ~60 tokens; 512 es techo
 *  holgado. Es techo de DECISIÓN, no de generación — el contenido rico
 *  del chat sigue usando LLM_MAX_TOKENS. */
export const GHOST_BRAIN_MAX_TOKENS = 512;

/** When a provider response is truncated (finish_reason = max_tokens|length),
 *  the subagent loop sends a "continue" turn so the model can resume its
 *  output instead of treating it as a terminal failure. */
export const MAX_CONTINUE_RETRIES = 2;

// ═══════════════════════════════════════════════
// Pre-flight conversation validation (Level 6)
// ═══════════════════════════════════════════════

export interface ConversationValidation {
  ok: boolean;
  /** Index of the message where orphaned tool_calls were detected. */
  orphanedAt?: number;
  /** Human-readable explanation of the violation. */
  detail?: string;
  /** tool_call_ids that never received corresponding tool results. */
  pendingIds?: string[];
}

/** Validates that assistant messages with tool_calls are always followed by
 *  the required number of tool-result messages before the next assistant
 *  message or the end of the conversation. OpenAI-compatible APIs reject
 *  conversations that violate this invariant with a 400 error.
 *
 *  Call this BEFORE every API request to catch structural corruption
 *  locally instead of wasting tokens on a guaranteed 400. */
export function validateConversationStructure(
  messages: any[],
  isAnthropic: boolean,
): ConversationValidation {
  const pending = new Map<string, number>(); // tool_call_id → message index

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;

    // ── Extract tool-call IDs from this assistant message ──
    const newCallIds: string[] = [];
    if (!isAnthropic && msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc?.id) newCallIds.push(tc.id);
      }
    }
    if (isAnthropic && msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_use" && block?.id) newCallIds.push(block.id);
      }
    }

    // ── Check: orphaned tool_calls from a PREVIOUS assistant message? ──
    if (newCallIds.length > 0 && pending.size > 0) {
      return {
        ok: false,
        orphanedAt: i,
        detail: `New tool_calls at index ${i} (${newCallIds.join(",")}) while ${pending.size} previous tool_calls still need responses: ${[...pending.keys()].join(",")}`,
        pendingIds: [...pending.keys()],
      };
    }

    // ── Track new pending tool calls ──
    for (const id of newCallIds) pending.set(id, i);

    // ── Resolve tool results ──
    if (!isAnthropic && msg.role === "tool" && typeof msg.tool_call_id === "string") {
      pending.delete(msg.tool_call_id);
    }
    if (isAnthropic && msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === "tool_result" && typeof block?.tool_use_id === "string") {
          pending.delete(block.tool_use_id);
        }
      }
    }
  }

  // ── Check: any tool_calls that never got results? ──
  if (pending.size > 0) {
    return {
      ok: false,
      orphanedAt: messages.length - 1,
      detail: `${pending.size} tool_calls never received responses (at end of conversation): ${[...pending.keys()].join(",")}`,
      pendingIds: [...pending.keys()],
    };
  }

  return { ok: true };
}

export interface WorkContract {
  mode?: "create" | "edit";
  expectedTemplateCount?: number;
  expectedFrameCount?: number;
  requiredWidth?: number;
  requiredHeight?: number;
  requiredTexts?: string[];
  requiredTextsByFrame?: string[][];
  requiredStyle?: string;
  /** If the leader already knows the exact brand/guideline ID (from bootstrap),
   *  the implementer can skip name-based search and use this directly. */
  brandId?: string;
}

export interface WorkManifest {
  expected: WorkContract;
  createdTemplateIds: string[];
  pendingTemplateCount: number;
  pendingFrameCount: number;
  styleEvidence: string[];
}

export interface ArtifactSnapshot {
  id: string;
  brandId?: string;
  designArtifacts?: { sharedCss?: string; [key: string]: unknown };
  width?: number;
  height?: number;
  html?: string;
  css?: string;
  frames?: Array<{
    width?: number;
    height?: number;
    html?: string;
    css?: string;
  }>;
  styleEvidence?: string[];
  styleReferences?: StyleReference[];
}

export type AgentOutcome = "success" | "partial" | "blocked" | "error" | "verification_failed";
export type ReviewerVerdict = "APPROVED" | "CHANGES_REQUESTED" | "unknown";

export function parseReviewerVerdict(text: unknown): ReviewerVerdict {
  const verdicts = String(text ?? "")
    .split(/\r?\n/)
    .map(line => line.trim().match(/^(APPROVED|CHANGES_REQUESTED)(?:\s*(?:->|:).*)?$/)?.[1])
    .filter(Boolean);
  const uniqueVerdicts = [...new Set(verdicts)];
  return uniqueVerdicts.length === 1 ? uniqueVerdicts[0] as ReviewerVerdict : "unknown";
}

export type SubagentProgressState = "starting" | "thinking" | "executing_tool" | "retrying" | "compacted" | "done" | "error" | "cancelled";
export type TokenCountKind = "actual" | "estimated";

export interface SubagentProgress {
  runId: string;
  state: SubagentProgressState;
  role: "implementer" | "reviewer";
  round: number;
  maxRounds: number;
  elapsedMs: number;
  provider: string;
  model: string;
  currentTool?: string;
  callId?: string;
  attempt?: number;
  inputTokens: number;
  outputTokens: number;
  cumulativeTokens: number;
  tokenCountKind: TokenCountKind;
  templateIds: string[];
  sessionId?: string;
  emittedAt: number;
  reason?: string;
  contextChars?: number;
}

export interface AgentRunStats {
  runId: string;
  role: "implementer" | "reviewer";
  elapsedMs: number;
  rounds: number;
  maxRounds: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cumulativeTokens: number;
  tokenCountKind: TokenCountKind;
  templateIds: string[];
  sessionId?: string;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function readOpenAiUsage(data: any): ProviderUsage | null {
  const usage = data?.usage;
  const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const total = Number(usage?.total_tokens);
  return { inputTokens, outputTokens, totalTokens: Number.isFinite(total) ? total : inputTokens + outputTokens };
}

export function readAnthropicUsage(data: any): ProviderUsage | null {
  const inputTokens = Number(data?.usage?.input_tokens);
  const outputTokens = Number(data?.usage?.output_tokens);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

export function readProviderUsage(data: any, isAnthropic: boolean): ProviderUsage | null {
  return isAnthropic ? readAnthropicUsage(data) : readOpenAiUsage(data);
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatTokens(tokens: number): string {
  const count = Math.max(0, Math.round(tokens));
  if (count < 1000) return count.toLocaleString("en-US");
  return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`;
}

export function sanitizeRuntimeText(value: unknown, maxLength = 1000): string {
  return String(value ?? "")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|fdr_ws_[A-Za-z0-9_-]+)\b/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "[style omitted]")
    .replace(/<[^>]{0,500}>/g, "[html omitted]")
    .slice(0, Math.max(0, maxLength));
}

export interface RetryNotice { attempt: number; reason: "timeout" | "network" | "rate_limit" | "server_error"; delayMs: number }

export interface SerialPromiseQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}

export function createSerialPromiseQueue(): SerialPromiseQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>) {
      const result = tail.then(task, task);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    drain() {
      return tail;
    },
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Stopped by user", "AbortError"));
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); reject(new DOMException("Stopped by user", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  opts: {
    timeoutMs?: number;
    maxRetries?: number;
    maxTimeoutRetries?: number;
    totalDeadlineMs?: number;
    signal?: AbortSignal;
    onRetry?: (notice: RetryNotice) => void;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Response> {
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 75_000, 1), 75_000);
  const maxRetries = Math.min(Math.max(opts.maxRetries ?? 2, 0), 2);
  const maxTimeoutRetries = Math.min(Math.max(opts.maxTimeoutRetries ?? 1, 0), 1);
  const deadlineMs = Math.max(opts.totalDeadlineMs ?? 5 * 60_000, 1);
  const startedAt = Date.now();
  const fetchImpl = opts.fetchImpl || fetch;
  let timeoutRetries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) throw new DOMException("Stopped by user", "AbortError");
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new DOMException("Provider deadline exceeded", "TimeoutError");
    const controller = new AbortController();
    let timedOut = false;
    const externalAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", externalAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(timeoutMs, remaining));
    let retryReason: RetryNotice["reason"] | null = null;
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (response.status === 429) retryReason = "rate_limit";
      else if (response.status >= 500) retryReason = "server_error";
      else return response;
      if (attempt >= maxRetries) return response;
    } catch (error: any) {
      if (opts.signal?.aborted) throw new DOMException("Stopped by user", "AbortError");
      if (timedOut) {
        timeoutRetries += 1;
        retryReason = "timeout";
        if (timeoutRetries > maxTimeoutRetries) throw new DOMException("Provider attempt timed out", "TimeoutError");
      } else if (error?.name === "AbortError") {
        throw error;
      } else {
        retryReason = "network";
      }
      if (attempt >= maxRetries) throw error;
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", externalAbort);
    }

    const remainingAfterAttempt = deadlineMs - (Date.now() - startedAt);
    if (!retryReason || remainingAfterAttempt <= 0) throw new DOMException("Provider deadline exceeded", "TimeoutError");
    // Reserve most of the remaining deadline for the retry itself. Letting
    // backoff consume `remaining - 1` reported a retry but never started it.
    const delayMs = Math.min(1000 * (2 ** attempt), 10_000, Math.max(0, Math.floor(remainingAfterAttempt / 4)));
    opts.onRetry?.({ attempt: attempt + 2, reason: retryReason, delayMs });
    if (delayMs > 0) await abortableDelay(delayMs, opts.signal);
  }
  throw new Error("fetchWithRetry: unreachable");
}

export const MUTATION_TOOL_NAMES = new Set([
  "create_html_template", "create_html_carousel", "create_template", "create_deck", "create_frame",
  "create_html_frame", "import_template", "import_design", "assemble_template",
  "duplicate_template", "create_from_recipe", "generate_from_prompt",
  "generate_ui_components", "image_to_design", "set_html", "set_css",
  "update_template", "update_frame_content", "update_html_frame", "set_frame_layers",
  "enhance_template", "apply_csv_to_frames", "apply_variables",
  "apply_brand_to_template", "auto_fix_brand", "add_font_to_template",
  "adapt_format", "adapt_all_formats", "save_version", "restore_version",
  "rename_template", "tag_template", "untag_template", "duplicate_frame",
  "replace_asset", "set_css_variable", "create_variable", "link_variable",
  "update_thumbnail",
]);

export const CREATOR_TOOL_NAMES = new Set([
  "create_html_template", "create_html_carousel", "create_template", "create_deck", "import_template",
  "import_design", "assemble_template", "duplicate_template", "create_from_recipe",
  "generate_from_prompt", "generate_ui_components", "image_to_design",
]);

function toolCallIds(message: any): string[] {
  if (!message || message.role !== "assistant") return [];
  const openAi = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call: any) => call?.id).filter(Boolean)
    : [];
  const anthropic = Array.isArray(message.content)
    ? message.content.filter((block: any) => block?.type === "tool_use").map((block: any) => block?.id).filter(Boolean)
    : [];
  return [...openAi, ...anthropic];
}

function toolResultIds(message: any): string[] {
  if (!message) return [];
  if (message.role === "tool" && message.tool_call_id) return [message.tool_call_id];
  if (message.role === "user" && Array.isArray(message.content)) {
    return message.content
      .filter((block: any) => block?.type === "tool_result")
      .map((block: any) => block?.tool_use_id)
      .filter(Boolean);
  }
  return [];
}

interface AtomicTurn {
  messages: any[];
  start: number;
  end: number;
}

function buildAtomicTurns(messages: any[]): AtomicTurn[] {
  const turns: AtomicTurn[] = [];
  const knownCalls = new Set<string>();
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    const callIds = toolCallIds(message);
    if (callIds.length > 0) {
      callIds.forEach(id => knownCalls.add(id));
      const grouped = [message];
      let cursor = index + 1;
      const pending = new Set(callIds);
      while (cursor < messages.length) {
        const resultIds = toolResultIds(messages[cursor]);
        if (resultIds.length === 0 || resultIds.some(id => !callIds.includes(id))) break;
        grouped.push(messages[cursor]);
        resultIds.forEach(id => pending.delete(id));
        cursor += 1;
        if (pending.size === 0) break;
      }
      turns.push({ messages: grouped, start: index, end: cursor - 1 });
      index = cursor;
      continue;
    }

    const resultIds = toolResultIds(message);
    if (resultIds.length > 0 && resultIds.some(id => !knownCalls.has(id))) {
      index += 1;
      continue;
    }

    turns.push({ messages: [message], start: index, end: index });
    index += 1;
  }

  return turns;
}

export function buildWorkManifest(
  expected: WorkContract = {},
  createdTemplateIds: string[] = [],
  createdFrameCount = 0,
  styleEvidence: string[] = [],
): WorkManifest {
  const uniqueIds = [...new Set(createdTemplateIds)].sort();
  return {
    expected: {
      mode: expected.mode,
      expectedTemplateCount: expected.expectedTemplateCount,
      expectedFrameCount: expected.expectedFrameCount,
      requiredWidth: expected.requiredWidth,
      requiredHeight: expected.requiredHeight,
      requiredTexts: [...(expected.requiredTexts || [])],
      requiredTextsByFrame: (expected.requiredTextsByFrame || []).map(texts => [...texts]),
      requiredStyle: expected.requiredStyle,
      brandId: expected.brandId,
    },
    createdTemplateIds: uniqueIds,
    pendingTemplateCount: Math.max(0, (expected.expectedTemplateCount || 0) - uniqueIds.length),
    pendingFrameCount: Math.max(0, (expected.expectedFrameCount || 0) - createdFrameCount),
    styleEvidence: [...new Set(styleEvidence)].sort(),
  };
}

export function compactConversationAtomic(
  messages: any[],
  options: { maxMessages: number; preserveFirstMessages?: number; manifest?: WorkManifest },
): { messages: any[]; compacted: boolean; droppedMessages: number } {
  const maxMessages = Math.max(3, options.maxMessages);
  if (messages.length <= maxMessages) return { messages, compacted: false, droppedMessages: 0 };

  const turns = buildAtomicTurns(messages);
  const preserveFirst = Math.max(0, options.preserveFirstMessages || 0);
  const prefixTurns = turns.filter(turn => turn.start < preserveFirst);
  const selected = new Set(prefixTurns);
  let used = prefixTurns.reduce((sum, turn) => sum + turn.messages.length, 0) + 1;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (selected.has(turn)) continue;
    if (used + turn.messages.length > maxMessages) continue;
    selected.add(turn);
    used += turn.messages.length;
  }

  const selectedTurns = turns.filter(turn => selected.has(turn));
  const firstRecent = selectedTurns.findIndex(turn => !prefixTurns.includes(turn));
  const marker = {
    role: "user",
    content: `[Conversation compacted atomically. Continue the task. Work manifest: ${serializeValidJson(options.manifest || buildWorkManifest(), 4000)}]`,
  };
  const compacted: any[] = [];
  selectedTurns.forEach((turn, index) => {
    if (index === firstRecent) compacted.push(marker);
    compacted.push(...turn.messages);
  });
  if (firstRecent < 0) compacted.push(marker);

  return {
    messages: compacted,
    compacted: true,
    droppedMessages: Math.max(0, messages.length - compacted.length + 1),
  };
}

function compactValue(value: any, stringLimit: number, arrayLimit: number, depth = 0): any {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= stringLimit ? value : `${value.slice(0, stringLimit)}\n[compacted ${value.length - stringLimit} chars]`;
  }
  if (depth > 8) return "[compacted nested value]";
  if (Array.isArray(value)) {
    const items = value.slice(0, arrayLimit).map(item => compactValue(item, stringLimit, arrayLimit, depth + 1));
    if (value.length > arrayLimit) items.push(`[compacted ${value.length - arrayLimit} items]`);
    return items;
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      compactValue(item, /^(tokensJson|designMd|sharedCss)$/i.test(key) ? stringLimit * 2 : stringLimit, arrayLimit, depth + 1),
    ]));
  }
  return String(value);
}

export function serializeValidJson(value: any, maxChars = 32_000): string {
  const first = JSON.stringify(value);
  if (first === undefined) return "null";
  if (first.length <= maxChars) return first;

  for (const [stringLimit, arrayLimit] of [[8000, 60], [4000, 30], [1600, 16], [600, 8]] as const) {
    const serialized = JSON.stringify(compactValue(value, stringLimit, arrayLimit));
    if (serialized.length <= maxChars) return serialized;
  }

  return JSON.stringify({ compacted: true, originalChars: first.length, summary: "Payload exceeded the safe context budget." });
}

export function estimateFullRequestTokens(system: unknown, messages: unknown[], tools: unknown[]): number {
  return Math.ceil(JSON.stringify({ system, messages, tools }).length / 4);
}

export function normalizeToolResult(raw: string, maxChars = 32_000): string {
  try {
    const parsed = JSON.parse(raw);
    const mcpText = parsed?.result?.content?.[0]?.text;
    if (typeof mcpText === "string") {
      try { return serializeValidJson(JSON.parse(mcpText), maxChars); }
      catch { return serializeValidJson({ text: mcpText }, maxChars); }
    }
    return serializeValidJson(parsed, maxChars);
  } catch {
    return serializeValidJson({ text: String(raw) }, maxChars);
  }
}

export function classifyHttpError(status: number, body: string): {
  category: "context_limit" | "bad_request" | "http_error";
  status: number;
  body: string;
} {
  const safeBody = String(body || "").slice(0, 2000);
  const contextLimit = /maximum context length|context(?: window| length)?(?: is)? (?:too (?:large|long)|exceeded)|context[_ -]?length[_ -]?exceeded|too many (?:input )?tokens|token limit exceeded/i.test(safeBody);
  return {
    category: status === 400 && contextLimit ? "context_limit" : status === 400 ? "bad_request" : "http_error",
    status,
    body: safeBody,
  };
}

function collectIds(result: any): string[] {
  if (!result || typeof result !== "object") return [];
  return [result.id, result.templateId, result?.data?.id, result?.data?.templateId]
    .filter((value): value is string => typeof value === "string" && value.startsWith("tpl_"));
}

export function captureArtifactIds(toolName: string, args: any, result: any): string[] {
  if (!MUTATION_TOOL_NAMES.has(toolName)) return [];
  let parsed = result;
  if (typeof result === "string") {
    try { parsed = JSON.parse(result); }
    catch { parsed = null; }
  }
  const ids = CREATOR_TOOL_NAMES.has(toolName) ? collectIds(parsed) : [];
  for (const candidate of [args?.templateId, args?.template_id]) {
    if (typeof candidate === "string" && candidate.startsWith("tpl_")) ids.push(candidate);
  }
  return [...new Set(ids)];
}

export function captureArtifactId(toolName: string, args: any, result: any): string | null {
  return captureArtifactIds(toolName, args, result)[0] || null;
}

export function captureCreatedFrameCount(toolName: string, result: unknown): number {
  if (!CREATOR_TOOL_NAMES.has(toolName)) return 0;
  let parsed: any = result;
  if (typeof result === "string") {
    try { parsed = JSON.parse(result); }
    catch { return 0; }
  }
  const count = Number(parsed?.totalFrames ?? parsed?.frameCount ?? parsed?.total_frames ?? 0);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export function extractVisibleText(html: string): string {
  let visible = typeof html === "string" ? html : "";
  visible = visible.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const hidden = /\bhidden(?:\s|=|$)|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))/i;
  let previous = "";
  while (previous !== visible) {
    previous = visible;
    visible = visible.replace(/<([a-z][\w:-]*)\b([^>]*)>[\s\S]*?<\/\1>/gi, (match, _tag, attrs) => hidden.test(attrs) ? " " : match);
    visible = visible.replace(/<([a-z][\w:-]*)\b([^>]*)>[\s\S]*?<\/\1>/gi, (match, tag, attrs) => {
      const nestedHidden = new RegExp(`<([a-z][\\w:-]*)\\b([^>]*)>[\\s\\S]*?<\\/\\1>`, "gi");
      return hidden.test(attrs) ? " " : `<${tag}${attrs}>${match.slice(match.indexOf(">") + 1, match.lastIndexOf(`</${tag}>`)).replace(nestedHidden, (nested, _nestedTag, nestedAttrs) => hidden.test(nestedAttrs) ? " " : nested)}</${tag}>`;
    });
  }
  visible = visible.replace(/\splaceholder\s*=\s*(?:"[^"]*"|'[^']*')/gi, " ");
  return visible.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

export function parseToolArguments(raw: unknown): { ok: true; value: Record<string, any> } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, error: "Tool arguments were empty." };
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== "object") return { ok: false, error: "Tool arguments must be a JSON object." };
    return { ok: true, value };
  } catch (error: any) {
    return { ok: false, error: `Invalid tool arguments JSON: ${error?.message || "parse failed"}` };
  }
}

export function validateDesignToolPayload(
  toolName: string,
  args: Record<string, any>,
  contract: WorkContract = {},
): { ok: true } | { ok: false; error: string } {
  const substantial = (value: unknown, minimum: number) =>
    typeof value === "string" && value.trim().length >= minimum;

  if (toolName === "create_html_template") {
    const html = args.html ?? args.initialHtml;
    const css = args.css ?? args.initialCss;
    if (!substantial(html, 40) || !substantial(css, 20)) {
      return { ok: false, error: "create_html_template requires substantial html (at least 40 characters) and css (at least 20 characters)." };
    }
  }

  if (toolName === "create_deck" || toolName === "create_html_carousel") {
    const entries = toolName === "create_deck" ? args.slides : args.frames;
    if (!Array.isArray(entries)) {
      return { ok: false, error: `${toolName} requires a non-empty ${toolName === "create_deck" ? "slides" : "frames"} array.` };
    }
    if (entries.length === 0) {
      return { ok: false, error: `${toolName} requires a non-empty ${toolName === "create_deck" ? "slides" : "frames"} array.` };
    }
    const invalidIndex = entries.findIndex((entry: any) =>
      !substantial(entry?.html, 40) || !substantial(entry?.css, 20));
    if (invalidIndex >= 0) {
      return { ok: false, error: `${toolName} entry ${invalidIndex + 1} requires substantial html (at least 40 characters) and css (at least 20 characters).` };
    }
    if (contract.expectedFrameCount !== undefined) {
      const producedFrames = toolName === "create_deck" ? entries.length + 1 : entries.length;
      if (producedFrames !== contract.expectedFrameCount) {
        const explanation = toolName === "create_deck" ? " (cover + content slides)" : "";
        return { ok: false, error: `${toolName} would create ${producedFrames} frames${explanation}; the contract requires ${contract.expectedFrameCount}.` };
      }
    }
  }

  return { ok: true };
}

export function validateWorkContract(contract: WorkContract | undefined): { ok: true } | { ok: false; error: string } {
  if (!contract || (contract.mode !== "create" && contract.mode !== "edit")) {
    return { ok: false, error: "Contract mode must be create or edit." };
  }
  const positiveInteger = (value: unknown) => Number.isInteger(value) && Number(value) > 0;
  const validDimension = (value: unknown) => Number.isFinite(value) && Number(value) >= 1 && Number(value) <= 10000;
  const validTexts = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(text => typeof text === "string");
  const validTextsByFrame = (value: unknown): value is string[][] =>
    Array.isArray(value) && value.every(validTexts);

  if (contract.mode === "create") {
    if (!positiveInteger(contract.expectedTemplateCount) || !positiveInteger(contract.expectedFrameCount)) {
      return { ok: false, error: "Create mode requires positive integer expectedTemplateCount and expectedFrameCount." };
    }
    if (!validDimension(contract.requiredWidth) || !validDimension(contract.requiredHeight)) {
      return { ok: false, error: "Create mode requires requiredWidth and requiredHeight between 1 and 10000." };
    }
    if (!validTexts(contract.requiredTexts)) {
      return { ok: false, error: "Create mode requires requiredTexts as an array of strings." };
    }
    // requiredTextsByFrame is OPTIONAL: when the leader provides it we get
    // precise per-frame text placement; when missing the implementer distributes
    // requiredTexts across frames itself. Failing hard here was the #1 cause of
    // contract rejection (the leader LLM often omits it).
    if (contract.requiredTextsByFrame !== undefined) {
      if (!validTextsByFrame(contract.requiredTextsByFrame) || contract.requiredTextsByFrame.length !== contract.expectedFrameCount) {
        return { ok: false, error: "requiredTextsByFrame must have exactly one string array per expected frame when provided." };
      }
    }
    if (typeof contract.requiredStyle !== "string" || !contract.requiredStyle.trim()) {
      return { ok: false, error: `Create mode requires requiredStyle. Use ${FREE_STYLE_SENTINEL} explicitly for free style.` };
    }
  }

  if (contract.mode === "edit") {
    if (contract.expectedTemplateCount !== undefined && !positiveInteger(contract.expectedTemplateCount)) return { ok: false, error: "expectedTemplateCount must be a positive integer when provided." };
    if (contract.expectedFrameCount !== undefined && !positiveInteger(contract.expectedFrameCount)) return { ok: false, error: "expectedFrameCount must be a positive integer when provided." };
    if (contract.requiredWidth !== undefined && !validDimension(contract.requiredWidth)) return { ok: false, error: "requiredWidth must be between 1 and 10000 when provided." };
    if (contract.requiredHeight !== undefined && !validDimension(contract.requiredHeight)) return { ok: false, error: "requiredHeight must be between 1 and 10000 when provided." };
    if (contract.requiredTexts !== undefined && !validTexts(contract.requiredTexts)) return { ok: false, error: "requiredTexts must be an array of strings when provided." };
    if (contract.requiredTextsByFrame !== undefined && !validTextsByFrame(contract.requiredTextsByFrame)) return { ok: false, error: "requiredTextsByFrame must be an array of string arrays when provided." };
    if (contract.requiredStyle !== undefined && (typeof contract.requiredStyle !== "string" || !contract.requiredStyle.trim())) return { ok: false, error: "requiredStyle must be non-empty when provided." };
  }
  return { ok: true };
}

export interface StyleReference {
  id?: string;
  name?: string;
}

export function extractStyleReferences(result: unknown): StyleReference[] {
  let parsed = result;
  if (typeof result === "string") {
    try { parsed = JSON.parse(result); }
    catch { return []; }
  }
  const source: any = parsed;
  const candidates = Array.isArray(source) ? source : [
    ...(Array.isArray(source?.styles) ? source.styles : []),
    ...(Array.isArray(source?.data) ? source.data : []),
    ...(Array.isArray(source?.brands) ? source.brands : []),
    source?.brand,
    source,
  ];
  const references: StyleReference[] = [];
  for (const candidate of candidates) {
    const id = typeof candidate?.id === "string" ? candidate.id : undefined;
    const name = typeof candidate?.name === "string" ? candidate.name : undefined;
    if (!id && !name) continue;
    if (!references.some(reference => reference.id === id && reference.name === name)) {
      references.push({ id, name });
    }
  }
  return references;
}

export function collectMutationStyleEvidence(
  toolName: string,
  args: Record<string, any>,
  consultedStyles: StyleReference[],
): string[] {
  if (!MUTATION_TOOL_NAMES.has(toolName)) return [];
  const evidence = new Set<string>();
  if (typeof args?.brandId === "string") {
    evidence.add(args.brandId);
    const consulted = consultedStyles.find(style => style.id === args.brandId);
    if (consulted?.name) evidence.add(consulted.name);
  }
  return [...evidence];
}

export function responseStoppedIncomplete(data: any, isAnthropic: boolean): boolean {
  const reason = isAnthropic ? data?.stop_reason : data?.choices?.[0]?.finish_reason;
  return reason === "max_tokens" || reason === "length";
}

export function selectProviderTools<T extends { function?: { name?: string } }>(tools: T[], providerId: string): T[] {
  if (!providerId.toLowerCase().includes("deepseek") || tools.length <= DEEPSEEK_MAX_TOOLS) return tools;
  const mustKeep = new Set([
    "create_html_template", "create_html_carousel", "create_template", "create_deck", "create_frame", "create_html_frame",
    "set_html", "set_css", "get_template", "list_templates", "list_frames", "get_frame",
    "list_brand_guidelines", "get_brand_guideline", "get_active_styles", "get_brands",
    "search_icons", "insert_icon", "list_assets", "upload_image",
    "harness_log_entry", "harness_dump_context", "harness_submit_for_review", "harness_report_error",
  ]);
  const required = tools.filter(tool => mustKeep.has(tool.function?.name || ""));
  const rest = tools.filter(tool => !mustKeep.has(tool.function?.name || ""));
  return [...required, ...rest].slice(0, DEEPSEEK_MAX_TOOLS);
}

/** Normalize text for fuzzy matching: decompose Unicode, map confusable chars,
 *  collapse whitespace. Solves × vs x, ó corruption, and similar encoding mismatches
 *  between leader-written contracts and implementer-generated HTML. */
export function normalizeForMatching(text: string): string {
  return text
    .normalize("NFKD")                          // decompose accented chars (é → e + combining accent)
    .replace(/[\u0300-\u036f]/g, "")            // strip combining diacritical marks
    .replace(/[\u00d7\u2715\u2716]/g, "x")      // × ✕ ✖ → x
    .replace(/[\u2013\u2014\u2015]/g, "-")      // – — ― → -
    .replace(/[\u201c\u201d\u201e]/g, '"')     // “ ” „ → "
    .replace(/[\u2018\u2019\u201a]/g, "'")     // ' ' ‚ → '
    .replace(/[\u00a0]/g, " ")                  // non-breaking space → space
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ── Quality warnings (non-blocking) ──
// These detect aesthetic issues the structural checks miss:
// serif fonts when brand defines sans-serif, clipped decorative circles,
// and content overflowing frame bounds.

/** Detect serif fonts that contradict brand sans-serif tokens. */
function auditFontFamily(css: string, artifactId: string, frameIndex: number, brandSharedCss?: string): string[] {
  const warnings: string[] = [];
  // Extract brand's expected font-family from sharedCss tokens
  const brandFontMatch = (brandSharedCss || "").match(/--font-family\s*:\s*([^;}\n]+)/);
  if (!brandFontMatch) return warnings; // no brand font token to compare against
  const brandFont = brandFontMatch[1].trim().toLowerCase();
  if (!brandFont.includes("sans") && !brandFont.includes("inter") && !brandFont.includes("system-ui")) return warnings;

  // Find font-family declarations in frame CSS
  const fontMatches = css.matchAll(/font-family\s*:\s*([^;}\n]+)/gi);
  for (const match of fontMatches) {
    const value = match[1].trim().toLowerCase();
    if (value.includes("serif") && !value.includes("sans")) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: font-family "${match[1].trim()}" may contradict brand token "${brandFontMatch[1].trim()}" (serif detected, brand expects sans-serif)`);
    }
    if (value.includes("times") || value.includes("georgia") || value.includes("garamond")) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: serif font "${match[1].trim()}" detected — brand likely expects sans-serif`);
    }
  }
  return warnings;
}

/** Detect decorative circles that may be clipped by overflow:hidden containers. */
function auditCircleClipping(html: string, css: string, artifactId: string, frameIndex: number, frameWidth: number, frameHeight: number): string[] {
  const warnings: string[] = [];
  // Find circles: elements with border-radius:50% (common in the Futuraria infographic style)
  const hasCircles = /border-radius\s*:\s*50%/.test(css);
  if (!hasCircles) return warnings;

  // Check for overflow:hidden on parent containers that could clip circles
  const overflowHiddenSelectors: string[] = [];
  const overflowMatches = css.matchAll(/([^{]+)\{[^}]*overflow\s*:\s*hidden[^}]*\}/gi);
  for (const match of overflowMatches) {
    const selector = match[1].trim();
    // Skip :root, body, and .frame — these are the outer containers and are expected
    if (/^:root|^body|^\.frame|^#__df_content/.test(selector)) continue;
    overflowHiddenSelectors.push(selector);
  }

  if (overflowHiddenSelectors.length > 0) {
    // Check if circles might be children of overflow:hidden containers
    // Simple heuristic: if the circle's size exceeds 50% of frame, it's likely decorative
    const circleSizes = css.matchAll(/(?:width|height)\s*:\s*(\d+)px/gi);
    let maxCircleSize = 0;
    for (const sizeMatch of circleSizes) {
      const px = parseInt(sizeMatch[1], 10);
      if (px > maxCircleSize) maxCircleSize = px;
    }
    if (maxCircleSize > Math.min(frameWidth, frameHeight) * 0.3) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: decorative circles (max ${maxCircleSize}px) may be clipped by overflow:hidden containers: ${overflowHiddenSelectors.join(", ")}. Use overflow:visible on decorative containers.`);
    }
  }
  return warnings;
}

/** Detect content that may overflow frame bounds. */
function auditContentOverflow(html: string, css: string, artifactId: string, frameIndex: number, frameWidth: number, frameHeight: number): string[] {
  const warnings: string[] = [];

  // Check for absolute-positioned elements outside frame bounds
  const absPositionMatches = html.matchAll(/style="[^"]*(?:left|right|top|bottom)\s*:\s*(-?\d+)px[^"]*"/gi);
  for (const match of absPositionMatches) {
    const style = match[0];
    const leftMatch = style.match(/left\s*:\s*(-?\d+)px/i);
    const rightMatch = style.match(/right\s*:\s*(-?\d+)px/i);
    const topMatch = style.match(/top\s*:\s*(-?\d+)px/i);
    const bottomMatch = style.match(/bottom\s*:\s*(-?\d+)px/i);

    if (leftMatch && parseInt(leftMatch[1], 10) < -50) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: element positioned at left:${leftMatch[1]}px — outside frame bounds`);
    }
    if (rightMatch && parseInt(rightMatch[1], 10) < -50) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: element positioned at right:${rightMatch[1]}px — outside frame bounds`);
    }
    if (topMatch && parseInt(topMatch[1], 10) < -50) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: element positioned at top:${topMatch[1]}px — outside frame bounds`);
    }
    if (bottomMatch && parseInt(bottomMatch[1], 10) < -50) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: element positioned at bottom:${bottomMatch[1]}px — outside frame bounds`);
    }
  }

  // Check for white-space:nowrap without overflow:hidden — text may overflow
  if (/white-space\s*:\s*nowrap/.test(css) && !/overflow\s*:\s*hidden/.test(css)) {
    warnings.push(`${artifactId} frame ${frameIndex + 1}: white-space:nowrap without overflow:hidden — text may overflow frame bounds`);
  }

  // Check for elements with fixed widths larger than frame
  const widthMatches = css.matchAll(/(?:width|min-width)\s*:\s*(\d+)px/gi);
  for (const widthMatch of widthMatches) {
    const px = parseInt(widthMatch[1], 10);
    if (px > frameWidth + 10) {
      warnings.push(`${artifactId} frame ${frameIndex + 1}: element width ${px}px exceeds frame width ${frameWidth}px — content will overflow`);
    }
  }

  return warnings;
}

export function evaluateCompleteness(input: {
  contract?: WorkContract;
  artifacts: ArtifactSnapshot[];
  madeMutationToolCall: boolean;
  hitRoundLimit?: boolean;
  aborted?: boolean;
  error?: string;
  createdArtifactIds?: string[];
}): { outcome: AgentOutcome; verification_failed: boolean; errors: string[]; warnings: string[]; verifiedTemplateIds: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contract = input.contract || {};
  if (input.error) errors.push(input.error);
  if (input.aborted) errors.push("Subagent was aborted.");
  if (input.hitRoundLimit) errors.push(`Subagent reached the ${MAX_SUBAGENT_ROUNDS}-round limit.`);
  if (!input.madeMutationToolCall) errors.push("No design mutation tool was executed.");
  if (contract.mode === "create" && (!input.createdArtifactIds || input.createdArtifactIds.length === 0)) {
    errors.push("Create mode requires an artifact ID returned by a successful creator tool in this session.");
  }
  if (contract.mode === "create") {
    const createdIds = new Set(input.createdArtifactIds || []);
    const unproven = input.artifacts.filter(artifact => !createdIds.has(artifact.id)).map(artifact => artifact.id);
    if (unproven.length > 0) errors.push(`Create mode has artifacts without creator provenance: ${unproven.join(", ")}.`);
    if (contract.expectedTemplateCount !== undefined && createdIds.size !== contract.expectedTemplateCount) {
      errors.push(`Expected ${contract.expectedTemplateCount} creator-proven artifact(s), got ${createdIds.size}.`);
    }
  }
  if (contract.mode === "create" && (contract.requiredWidth === undefined || contract.requiredHeight === undefined)) {
    errors.push("Create mode requires requiredWidth and requiredHeight.");
  }
  if (contract.expectedTemplateCount !== undefined && input.artifacts.length !== contract.expectedTemplateCount) {
    errors.push(`Expected ${contract.expectedTemplateCount} template(s), got ${input.artifacts.length}.`);
  }
  const frameCount = input.artifacts.reduce((sum, artifact) => sum + (artifact.frames?.length || (artifact.html ? 1 : 0)), 0);
  if (contract.expectedFrameCount !== undefined && frameCount !== contract.expectedFrameCount) {
    errors.push(`Expected ${contract.expectedFrameCount} frame(s), got ${frameCount}.`);
  }
  for (const artifact of input.artifacts) {
    const frames = artifact.frames?.length ? artifact.frames : [artifact];
    for (const frame of frames) {
      const width = frame.width ?? artifact.width;
      const height = frame.height ?? artifact.height;
      if (contract.requiredWidth !== undefined && width !== contract.requiredWidth) errors.push(`${artifact.id}: width ${width ?? "missing"}, expected ${contract.requiredWidth}.`);
      if (contract.requiredHeight !== undefined && height !== contract.requiredHeight) errors.push(`${artifact.id}: height ${height ?? "missing"}, expected ${contract.requiredHeight}.`);
      if ((frame.html || "").trim().length < 40) errors.push(`${artifact.id}: HTML is not substantial.`);
      if ((frame.css || "").trim().length < 20) errors.push(`${artifact.id}: CSS is not substantial.`);
      if (/\b(?:lorem ipsum|todo|placeholder|replace me)\b/i.test(extractVisibleText(frame.html || ""))) {
        errors.push(`${artifact.id}: placeholder content remains.`);
      }
    }
  }
  const allFrames = input.artifacts.flatMap(artifact => artifact.frames?.length ? artifact.frames : [artifact]);
  const allText = normalizeForMatching(allFrames.map(frame => extractVisibleText(frame.html || "")).join(" "));
  for (const requiredText of contract.requiredTexts || []) {
    if (!allText.includes(normalizeForMatching(requiredText))) errors.push(`Missing required text: ${requiredText}`);
  }
  for (const [frameIndex, requiredTexts] of (contract.requiredTextsByFrame || []).entries()) {
    const frameText = normalizeForMatching(extractVisibleText(allFrames[frameIndex]?.html || ""));
    if (requiredTexts.length > 0 && !frameText) errors.push(`Frame ${frameIndex + 1} has no visible text.`);
    for (const requiredText of requiredTexts) {
      if (!frameText.includes(normalizeForMatching(requiredText))) errors.push(`Frame ${frameIndex + 1} is missing required text: ${requiredText}`);
    }
  }
  if (contract.requiredStyle && contract.requiredStyle !== FREE_STYLE_SENTINEL) {
    const hasContractBrandMatch = typeof contract.brandId === "string" &&
      contract.brandId.length > 0 &&
      input.artifacts.some(artifact => artifact.brandId === contract.brandId);
    // Pre-compute brand marker presence: if every artifact with a brandId has
    // the marker in all its frames, brand application is proven even without
    // the style name in evidence or styleReferences.
    const allBrandedProven = input.artifacts.length > 0 && input.artifacts.every(artifact => {
      if (!artifact.brandId) return false;
      const marker = `futuraria-brand:${artifact.brandId}:start`;
      const frames = artifact.frames?.length ? artifact.frames : [artifact];
      return frames.every(frame => (frame.css || "").includes(marker));
    });
    const evidence = input.artifacts.flatMap(artifact => artifact.styleEvidence || []).join(" ").toLowerCase();
    // Accept style evidence by: (a) name match, (b) contract.brandId match, or (c) proven brand marker application
    if (!evidence.includes(contract.requiredStyle.toLowerCase()) && !hasContractBrandMatch && !allBrandedProven) {
      errors.push(`Missing style evidence: ${contract.requiredStyle}`);
    }
    for (const artifact of input.artifacts) {
      if (!artifact.brandId) {
        errors.push(`${artifact.id}: requested style ${contract.requiredStyle} has no applied brandId.`);
        continue;
      }
      // If the leader explicitly authorized this brandId in the contract, skip the
      // styleReferences lookup — the leader said "use this directly, don't look it up."
      const leaderAuthorized = typeof contract.brandId === "string" && artifact.brandId === contract.brandId;
      const marker = `futuraria-brand:${artifact.brandId}:start`;
      const effectiveFrames = artifact.frames?.length ? artifact.frames : [artifact];
      if (!leaderAuthorized) {
        const boundStyle = (artifact.styleReferences || []).find(reference =>
          reference.id === artifact.brandId &&
          typeof reference.name === "string" &&
          reference.name.toLowerCase().includes(contract.requiredStyle!.toLowerCase()));
        if (!boundStyle) {
          errors.push(`${artifact.id}: applied brandId ${artifact.brandId} is not bound to requested style ${contract.requiredStyle}.`);
        }
      }
      if (!(artifact.designArtifacts?.sharedCss || "").trim()) {
        errors.push(`${artifact.id}: applied brand ${artifact.brandId} has no sharedCss.`);
      }
      for (const [index, frame] of effectiveFrames.entries()) {
        if (!(frame.css || "").includes(marker)) {
          errors.push(`${artifact.id}: frame ${index + 1} is missing applied brand CSS marker for ${artifact.brandId}.`);
        }
      }
    }
  }

  // ── Quality warnings (non-blocking) — catch aesthetic issues ──
  for (const artifact of input.artifacts) {
    const brandSharedCss = artifact.designArtifacts?.sharedCss;
    const frames = artifact.frames?.length ? artifact.frames : [artifact];
    for (const [index, frame] of frames.entries()) {
      const fw = frame.width ?? artifact.width ?? 0;
      const fh = frame.height ?? artifact.height ?? 0;
      const combinedCss = [brandSharedCss, frame.css || artifact.css || ""].filter(Boolean).join("\n");
      const frameHtml = frame.html || artifact.html || "";
      warnings.push(...auditFontFamily(combinedCss, artifact.id, index, brandSharedCss));
      if (fw > 0 && fh > 0) {
        warnings.push(...auditCircleClipping(frameHtml, combinedCss, artifact.id, index, fw, fh));
        warnings.push(...auditContentOverflow(frameHtml, combinedCss, artifact.id, index, fw, fh));
      }
    }
  }

  const verificationFailed = errors.length > 0;
  return {
    outcome: verificationFailed ? "verification_failed" : "success",
    verification_failed: verificationFailed,
    errors,
    warnings,
    verifiedTemplateIds: verificationFailed ? [] : input.artifacts.map(artifact => artifact.id),
  };
}
