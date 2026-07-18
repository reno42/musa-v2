/**
 * Perf budgets (PLAN_EDITOR_CORE §3.2) on a 200-layer frame with 10 inlined
 * base64 images — the shape of the batch designs that feel sluggish.
 *
 * Budgets (asserts, not opinions):
 *   selección  (mousedown → overlay box)      < 50 ms
 *   commit     (mouseup → estilo aplicado)     < 30 ms
 *   drag       (coste por mousemove)           < 18.2 ms  (≥55fps)
 *
 * These are guards: they must be GREEN today OR turn green by Sprint 2 and then
 * STAY green. The runner reports the real measured numbers either way.
 */
import { makeReport } from "./lib/assert.mjs";
import { createHeavyTemplate, deleteTemplate } from "./lib/mcp.mjs";

const PERF_PROBE = /* js */ `
(function(frameId){
  const wrapper = document.querySelector('[data-frame-id="' + frameId + '"]');
  const host = [...wrapper.querySelectorAll('div')].find(el => el.shadowRoot && el.shadowRoot.getElementById('__df_content'));
  const shadow = host.shadowRoot;
  const content = shadow.getElementById('__df_content');
  const overlay = shadow.getElementById('__df_overlay');
  const zoom = host.getBoundingClientRect().width / (host.offsetWidth || 1);
  const target = content.querySelector('[data-layer-id="box_100"]');
  const r = target.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const fire = (t, type, x, y, extra) => t.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles:true, cancelable:true, composed:true, view:window, button:0, clientX:x, clientY:y }, extra||{})));
  const hasBox = () => [...overlay.children].some(c => c.tagName === 'DIV' && /solid/.test(c.style.border||''));

  // selection latency
  const t0 = performance.now();
  fire(target, 'mousedown', cx, cy);
  const selMs = performance.now() - t0;
  fire(document, 'mouseup', cx, cy); // release without moving (pure select)

  // drag cost per move
  fire(target, 'mousedown', cx, cy);
  const moves = 30;
  const tDrag = performance.now();
  for (let i = 1; i <= moves; i++) fire(document, 'mousemove', cx + i * 2 * zoom, cy + zoom, { buttons: 1 });
  const dragPerMove = (performance.now() - tDrag) / moves;

  // commit latency: mouseup → the layer's inline style reflects the move
  const tUp = performance.now();
  fire(document, 'mouseup', cx + moves * 2 * zoom, cy + zoom);
  const committed = !!(target.style.left || target.style.translate);
  const commitMs = performance.now() - tUp;

  return { selMs, dragPerMove, commitMs, selBoxAppeared: hasBox(), committed };
})(${JSON.stringify("__FRAME__")});
`;

export async function run(harness) {
  const report = makeReport("Perf · presupuestos en frame de 200 capas");
  const { templateId, frameId, layerCount } = await createHeavyTemplate(200, 10);
  try {
    await harness.open(templateId, frameId);
    report.ok("frame pesado cargó", true, `${layerCount} capas`);

    const m = await harness.page.evaluate(PERF_PROBE.replace("__FRAME__", frameId));
    await harness.settle();

    report.ok("selección < 50ms", m.selMs < 50, `${m.selMs.toFixed(1)}ms`);
    report.ok("commit < 30ms", m.commitMs < 30, `${m.commitMs.toFixed(1)}ms`);
    report.ok("drag ≥55fps (coste/move < 18.2ms)", m.dragPerMove < 18.2, `${m.dragPerMove.toFixed(2)}ms/move ≈ ${(1000 / m.dragPerMove).toFixed(0)}fps`);

    return report;
  } finally {
    await deleteTemplate(templateId);
  }
}
