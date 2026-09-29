// Deterministic context benchmark. Run on the same fixture before and after
// changing ChatFAB's compaction policy; these are approximate input tokens,
// not provider billing data.
import { compactConversationAtomic, compactConversationForBudget, estimateFullRequestTokens } from "../src/lib/agentRuntime.ts";

const rounds = 28;
const system = "S".repeat(3_000);
const tools = [{ function: { name: "design_tools", description: "T".repeat(20_000) } }];

function run(policy) {
  let messages = [{ role: "user", content: "Design a campaign with verified deliverables." }];
  let total = 0;
  let peak = 0;
  let compactions = 0;
  for (let round = 0; round < rounds; round++) {
    if (policy === "baseline" && estimateFullRequestTokens(system, messages, tools) > 70_000) {
      for (const maxMessages of [40, 24]) {
        if (estimateFullRequestTokens(system, messages, tools) <= 70_000) break;
        const result = compactConversationAtomic(messages, { maxMessages, preserveFirstMessages: 2 });
        if (!result.compacted) break;
        messages = result.messages;
        compactions++;
      }
    } else if (policy === "candidate") {
      const result = compactConversationForBudget(system, messages, tools, { preserveFirstMessages: 2 });
      messages = result.messages;
      if (result.compacted) compactions++;
    }
    const tokens = estimateFullRequestTokens(system, messages, tools);
    total += tokens;
    peak = Math.max(peak, tokens);
    const id = `call_${round}`;
    messages.push({ role: "assistant", tool_calls: [{ id, function: { name: "get_template", arguments: "{}" } }] });
    messages.push({ role: "tool", tool_call_id: id, content: `result_${round}:` + String(round).repeat(5_200) });
    if (round % 5 === 4) messages.push({ role: "user", content: `Continue the same campaign, batch ${round + 1}.` });
  }
  return { approximateInputTokens: total, peakRequestTokens: peak, compactions };
}

const baseline = run("baseline");
const candidate = run("candidate");
console.log(JSON.stringify({ fixture: `${rounds} sequential tool rounds, 5.2k-character result each`, baseline, candidate,
  reductionPercent: +((1 - candidate.approximateInputTokens / baseline.approximateInputTokens) * 100).toFixed(1) }, null, 2));
