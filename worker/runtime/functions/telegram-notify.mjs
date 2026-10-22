// ═══════════════════════════════════════════════════════════════
// telegram-notify.mjs — Best-effort Telegram notification helper
// ═══════════════════════════════════════════════════════════════
//
// Used by process_daily_batch to notify users when their batch finishes.
// Requires TELEGRAM_BOT_TOKEN env var. Falls through silently if unset.
//
// Usage:
//   const { sendTelegram } = await import("./telegram-notify.mjs");
//   await sendTelegram(chatId, "🎨 Musa Daily Batch: 22/25 listos.");
// ═══════════════════════════════════════════════════════════════

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

/**
 * Send a Telegram message. Best-effort — never throws.
 * @param {string} chatId — Telegram chat ID
 * @param {string} message — Text to send (supports Markdown)
 */
export async function sendTelegram(chatId, message) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      console.error(`[telegram-notify] sendMessage failed: ${resp.status} ${await resp.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[telegram-notify] error: ${err.message}`);
    return false;
  }
}

/**
 * Format a batch completion message.
 */
export function formatBatchMessage({ workspaceId, success, failed, total }) {
  const lines = [`🎨 *Musa Daily Batch*`];
  lines.push(`✅ ${success}/${total} diseños listos`);
  if (failed > 0) {
    lines.push(`❌ ${failed} fallaron — revisá el Kanban`);
  }
  lines.push(`\n[Ver en editor](https://design.futuraria.com/?workspace=${workspaceId})`);
  return lines.join("\n");
}
