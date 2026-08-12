/**
 * Throwaway harness for grouping.
 *
 * `groupLayersInHtml` needs a DOM, so it cannot run under node's test runner.
 * Serve with `npx vite` and open /debug/grouping.html; results print to the page.
 */
import { createRoot } from "react-dom/client";
import { groupLayersInHtml, ungroupLayerInHtml, nestedGroupIds } from "../src/lib/htmlMutations";

const cases: Array<{ name: string; html: string; ids: string[]; expect: "grouped" | "refused" }> = [
  {
    name: "two siblings at the root",
    html: `<div data-layer-id="a"></div><div data-layer-id="b"></div>`,
    ids: ["a", "b"],
    expect: "grouped",
  },
  {
    name: "three siblings, one of them between two others",
    html: `<div data-layer-id="a"></div><div data-layer-id="x"></div><div data-layer-id="b"></div>`,
    ids: ["a", "b"],
    expect: "grouped",
  },
  {
    name: "layers in DIFFERENT parents",
    html: `<div data-layer-id="card"><p data-layer-id="a">A</p></div><div data-layer-id="b"></div>`,
    ids: ["a", "b"],
    expect: "refused",
  },
  {
    name: "a layer that does not exist",
    html: `<div data-layer-id="a"></div>`,
    ids: ["a", "ghost"],
    expect: "refused",
  },
  {
    name: "only one layer",
    html: `<div data-layer-id="a"></div><div data-layer-id="b"></div>`,
    ids: ["a"],
    expect: "refused",
  },
];

function run() {
  const rows = cases.map(c => {
    const result = groupLayersInHtml(c.html, c.ids, "grp_test");
    const got = result === null ? "refused" : "grouped";
    return {
      name: c.name,
      expected: c.expect,
      got,
      ok: got === c.expect,
      // Does the wrapper avoid generating a box of its own?
      displayContents: result ? /display:\s*contents/.test(result) : null,
      html: result,
    };
  });

  // Round trip: group then ungroup must return the original markup.
  const original = `<div data-layer-id="a"></div><div data-layer-id="b"></div>`;
  const grouped = groupLayersInHtml(original, ["a", "b"], "grp_rt");
  const back = grouped ? ungroupLayerInHtml(grouped, "grp_rt") : null;
  const roundTrip = back?.replace(/\s+/g, "") === original.replace(/\s+/g, "");
  const marked = grouped ? nestedGroupIds(grouped) : [];

  return { rows, roundTrip, marked, grouped };
}

const out = run();
(window as any).__groupingResults = out;

createRoot(document.getElementById("root") as HTMLElement).render(
  <div style={{ padding: 16, fontFamily: "system-ui", color: "#f0ebe0" }}>
    <h2>Agrupar — casos</h2>
    <table id="results" style={{ borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>{["caso", "esperado", "obtenido", "ok", "display:contents"].map(h => (
          <th key={h} style={{ textAlign: "left", padding: "4px 12px", borderBottom: "1px solid #444" }}>{h}</th>
        ))}</tr>
      </thead>
      <tbody>
        {out.rows.map(r => (
          <tr key={r.name}>
            <td style={{ padding: "4px 12px" }}>{r.name}</td>
            <td style={{ padding: "4px 12px" }}>{r.expected}</td>
            <td style={{ padding: "4px 12px" }}>{r.got}</td>
            <td style={{ padding: "4px 12px", color: r.ok ? "#8fd08f" : "#ff8080" }}>{r.ok ? "OK" : "FALLA"}</td>
            <td style={{ padding: "4px 12px" }}>{String(r.displayContents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p id="roundtrip">group → ungroup vuelve al original: <b>{String(out.roundTrip)}</b></p>
    <p id="marked">se marca como grupo: <b>{JSON.stringify(out.marked)}</b></p>
    <pre style={{ fontSize: 11, color: "#9a9484" }}>{out.grouped}</pre>
  </div>,
);
