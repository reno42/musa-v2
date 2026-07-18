/** Tiny assertion + reporting helper shared by the editor-interaction tests. */

export function makeReport(suiteName) {
  const checks = [];
  return {
    suiteName,
    ok(name, pass, detail = "") {
      checks.push({ name, pass: !!pass, detail });
      const icon = pass ? "  ✔" : "  ✖";
      console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
      return !!pass;
    },
    get passed() { return checks.every(c => c.pass); },
    get results() { return checks; },
  };
}

export function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
