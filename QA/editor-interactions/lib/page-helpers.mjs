/**
 * Observability + synthetic-input primitives that run INSIDE the page context
 * (installed on window.__qa). They reach into the editor's shadow DOM the same
 * way a user's mouse would, and read state a black-box test can trust:
 *
 *  - node identity: a JS property (__qaMark) set on each layer node. It is NEVER
 *    serialized, so if `content.innerHTML = frame.html` rebuilds the tree, every
 *    mark is gone → survivors === 0 proves a full re-creation.
 *  - selection: the `#__df_overlay` selection box (a bordered div) — present iff
 *    something is selected; its rect identifies WHICH layer.
 *  - html mutations during a gesture: a MutationObserver on the content subtree.
 *
 * Kept as a string so it can be injected verbatim via page.evaluate.
 */
export const PAGE_HELPERS = /* js */ `
window.__qa = (() => {
  const frameDom = (frameId) => {
    const wrapper = document.querySelector('[data-frame-id="' + frameId + '"]');
    if (!wrapper) return null;
    const host = [...wrapper.querySelectorAll('div')].find(el => el.shadowRoot && el.shadowRoot.getElementById('__df_content'));
    if (!host) return null;
    const shadow = host.shadowRoot;
    const content = shadow.getElementById('__df_content');
    const overlay = shadow.getElementById('__df_overlay');
    const layoutW = host.offsetWidth || 1;
    const zoom = host.getBoundingClientRect().width / layoutW;
    return { wrapper, host, shadow, content, overlay, zoom };
  };

  const layerNodes = (content) => [...content.querySelectorAll('[data-layer-id]')];

  const fire = (target, type, clientX, clientY, extra = {}) => {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, clientX, clientY, ...extra,
    }));
  };

  const centerOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
  };

  return {
    ready(frameId) {
      const dom = frameDom(frameId);
      return !!(window.futurariaAgent && dom && dom.content && dom.zoom > 0.01);
    },

    // Tag every layer node with an identity marker; returns how many were tagged.
    markNodes(frameId) {
      const dom = frameDom(frameId);
      if (!dom) return 0;
      let n = 0;
      for (const el of layerNodes(dom.content)) { el.__qaMark = ++n; }
      window.__qaMarkTotal = n;
      return n;
    },

    // How many originally-marked nodes still exist (identity preserved).
    countSurvivors(frameId) {
      const dom = frameDom(frameId);
      if (!dom) return 0;
      return layerNodes(dom.content).filter(el => typeof el.__qaMark === 'number').length;
    },

    // The selection box rect in content coordinates, or null if nothing selected.
    selectionBox(frameId) {
      const dom = frameDom(frameId);
      if (!dom || !dom.overlay) return null;
      const box = [...dom.overlay.children].find(c => c.tagName === 'DIV' && /solid/.test(c.style.border || ''));
      if (!box) return null;
      const cRect = dom.content.getBoundingClientRect();
      const bRect = box.getBoundingClientRect();
      return {
        x: Math.round((bRect.left - cRect.left) / dom.zoom),
        y: Math.round((bRect.top - cRect.top) / dom.zoom),
        w: Math.round(bRect.width / dom.zoom),
        h: Math.round(bRect.height / dom.zoom),
      };
    },

    // Which layer id the current selection box lines up with (or null).
    selectedLayerId(frameId) {
      const box = this.selectionBox(frameId);
      if (!box) return null;
      const dom = frameDom(frameId);
      const cRect = dom.content.getBoundingClientRect();
      let best = null, bestDelta = Infinity;
      for (const el of layerNodes(dom.content)) {
        const r = el.getBoundingClientRect();
        const x = (r.left - cRect.left) / dom.zoom;
        const y = (r.top - cRect.top) / dom.zoom;
        const delta = Math.abs(x - box.x) + Math.abs(y - box.y) + Math.abs(r.width / dom.zoom - box.w) + Math.abs(r.height / dom.zoom - box.h);
        if (delta < bestDelta) { bestDelta = delta; best = el.getAttribute('data-layer-id'); }
      }
      return bestDelta <= 6 ? best : null;
    },

    resolveTarget(frameId, layerId) {
      const dom = frameDom(frameId);
      return dom ? dom.content.querySelector('[data-layer-id="' + layerId + '"]') : null;
    },
    resolveChild(frameId, selector) {
      const dom = frameDom(frameId);
      return dom ? dom.content.querySelector(selector) : null;
    },

    // Full synthetic drag of an element by (dx,dy) content px, over N steps.
    dragEl(el, dx, dy, steps = 8) {
      if (!el) return { ok: false, reason: 'no element' };
      const c = centerOf(el);
      const dom = (() => { let n = el; while (n && n.id !== '__df_content') n = n.parentElement || n.getRootNode().host; return n; })();
      const zoom = dom ? dom.getBoundingClientRect().width / (dom.offsetWidth || 1) : 1;
      const pxDx = dx * zoom, pxDy = dy * zoom;
      fire(el, 'mousedown', c.x, c.y);
      for (let i = 1; i <= steps; i++) {
        fire(document, 'mousemove', c.x + (pxDx * i) / steps, c.y + (pxDy * i) / steps, { buttons: 1 });
      }
      fire(document, 'mouseup', c.x + pxDx, c.y + pxDy);
      return { ok: true };
    },
    dragLayer(frameId, layerId, dx, dy, steps) {
      return this.dragEl(this.resolveTarget(frameId, layerId), dx, dy, steps);
    },
    dragChild(frameId, selector, dx, dy, steps) {
      return this.dragEl(this.resolveChild(frameId, selector), dx, dy, steps);
    },
    // alt-drag duplicates the layer (an html-committing operation).
    altDragLayer(frameId, layerId, dx, dy, steps = 8) {
      const el = this.resolveTarget(frameId, layerId);
      if (!el) return { ok: false };
      const c = centerOf(el);
      const dom = frameDom(frameId);
      const zoom = dom.zoom;
      fire(el, 'mousedown', c.x, c.y, { altKey: true });
      for (let i = 1; i <= steps; i++) {
        fire(document, 'mousemove', c.x + (dx * zoom * i) / steps, c.y + (dy * zoom * i) / steps, { buttons: 1, altKey: true });
      }
      fire(document, 'mouseup', c.x + dx * zoom, c.y + dy * zoom, { altKey: true });
      return { ok: true };
    },

    // Plain click (mousedown+mouseup, no move) on an element.
    clickEl(el) {
      if (!el) return { ok: false };
      const c = centerOf(el);
      fire(el, 'mousedown', c.x, c.y);
      fire(document, 'mouseup', c.x, c.y);
      return { ok: true };
    },
    clickLayer(frameId, layerId) { return this.clickEl(this.resolveTarget(frameId, layerId)); },
    clickChild(frameId, selector) { return this.clickEl(this.resolveChild(frameId, selector)); },

    // Count structural mutations of the content subtree during a gesture.
    beginMutationSpy(frameId) {
      const dom = frameDom(frameId);
      if (!dom) return false;
      window.__qaMut = { added: 0, removed: 0 };
      window.__qaObs = new MutationObserver(muts => {
        for (const m of muts) {
          window.__qaMut.added += m.addedNodes.length;
          window.__qaMut.removed += m.removedNodes.length;
        }
      });
      window.__qaObs.observe(dom.content, { childList: true, subtree: true });
      return true;
    },
    endMutationSpy() {
      if (window.__qaObs) { window.__qaObs.disconnect(); window.__qaObs = null; }
      return window.__qaMut || { added: 0, removed: 0 };
    },

    // Geometric + style fingerprint for undo round-trip checks.
    fingerprint(frameId) {
      const report = window.futurariaAgent.inspectFrame(frameId);
      const geo = report.layers
        .map(l => l.layerId + ':' + l.x + ',' + l.y + ',' + l.width + ',' + l.height)
        .sort()
        .join('|');
      const dom = frameDom(frameId);
      const style = (dom && dom.shadow.querySelector('style') || {}).textContent || '';
      let h = 0;
      for (let i = 0; i < style.length; i++) { h = (h * 31 + style.charCodeAt(i)) | 0; }
      return geo + '#' + h;
    },
    layerRect(frameId, layerId) {
      const report = window.futurariaAgent.inspectFrame(frameId);
      return report.layers.find(l => l.layerId === layerId) || null;
    },

    key(type, key, extra = {}) {
      window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...extra }));
    },
    undo() { this.key('keydown', 'z', { ctrlKey: true }); },
    redo() { this.key('keydown', 'z', { ctrlKey: true, shiftKey: true }); },
  };
})();
true;
`;
