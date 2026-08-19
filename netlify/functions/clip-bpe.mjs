// ═══════════════════════════════════════════════════════════════════
// clip-bpe.mjs — CLIP BPE tokenizer (pure JS, no deps)
// ═══════════════════════════════════════════════════════════════════
// CLIPSeg's text input needs CLIP token ids. Shipping transformers.js
// into a Netlify function just for this would drag megabytes of unused
// machinery; CLIP's tokenizer is the classic GPT-2 BPE with a fixed
// regex — ~140 deterministic lines, verified against vocab.json +
// merges.txt from Xenova/clipseg-rd64-refined (the same weights the
// model was exported with).
//
// Contract: encode(text) → int[] ids (SOT … EOT), padTo77() for the
// model's fixed [1,77] input_ids slot.
// ═══════════════════════════════════════════════════════════════════

// GPT-2's reversible byte↔unicode table — CLIP reuses it verbatim.
function bytesToUnicode() {
  const bs = [];
  for (let i = 33; i < 127; i++) bs.push(i);
  for (let i = 161; i < 173; i++) bs.push(i);
  for (let i = 174; i < 256; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = new Map();
  bs.forEach((b, i) => map.set(b, String.fromCharCode(cs[i])));
  return map;
}

const BYTE_ENCODER = bytesToUnicode();

const CLIP_RE =
  /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;

const SOT = 49406;
const EOT = 49407;

export class ClipTokenizer {
  constructor(vocabJson, mergesText) {
    this.encoder = new Map(Object.entries(vocabJson).map(([k, v]) => [k, v]));
    const lines = mergesText.split("\n").filter(l => l && !l.startsWith("#version"));
    this.bpeRanks = new Map();
    lines.forEach((line, i) => this.bpeRanks.set(line.replace(/ /g, "\u00a0"), i));
    this.cache = new Map();
  }

  bpe(token) {
    if (this.cache.has(token)) return this.cache.get(token);
    let word = [...token].map(ch => [ch, null]);
    if (word.length < 2) {
      const out = word.length ? word[0][0] : "";
      this.cache.set(token, out);
      return out;
    }
    const getPairs = (w) => {
      const pairs = new Set();
      for (let i = 0; i < w.length - 1; i++) pairs.add(w[i][0] + "\u00a0" + w[i + 1][0]);
      return pairs;
    };
    let pairs = getPairs(word);
    for (;;) {
      let best = null;
      let bestRank = Infinity;
      for (const p of pairs) {
        const r = this.bpeRanks.get(p);
        if (r !== undefined && r < bestRank) { bestRank = r; best = p; }
      }
      if (best === null) break;
      const [first, second] = best.split("\u00a0");
      const newWord = [];
      for (let i = 0; i < word.length; i++) {
        if (i < word.length - 1 && word[i][0] === first && word[i + 1][0] === second) {
          newWord.push([first + second, null]);
          i++;
        } else {
          newWord.push(word[i]);
        }
      }
      word = newWord;
      if (word.length < 2) break;
      pairs = getPairs(word);
    }
    const out = word.map(w => w[0]).join(" ");
    this.cache.set(token, out);
    return out;
  }

  /** Encode text → token ids WITHOUT padding: [SOT, ...tokens, EOT]. */
  encode(text) {
    const clean = text.toLowerCase().replace(/\s+/g, " ").trim();
    const ids = [SOT];
    if (clean) {
      for (const raw of clean.match(CLIP_RE) || []) {
        const encoded = [...raw].map(ch => {
          // chars outside latin1 map through UTF-8 bytes like GPT-2 does
          const cp = ch.codePointAt(0);
          if (cp < 256) return BYTE_ENCODER.get(cp) || ch;
          return [...Buffer.from(ch, "utf-8")].map(b => BYTE_ENCODER.get(b)).join("");
        }).join("");
        for (const tok of this.bpe(encoded).split(" ")) {
          const id = this.encoder.get(tok);
          if (id !== undefined) ids.push(id);
        }
      }
    }
    ids.push(EOT);
    return ids;
  }

  /** Pad/truncate to CLIP's fixed 77-token context. */
  padTo77(ids) {
    const out = ids.slice(0, 77);
    while (out.length < 77) out.push(EOT);
    return out;
  }
}
