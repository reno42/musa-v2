/**
 * SceneStage3D — preview WebGL2 del material kind=scene (REQ-052).
 *
 * El payload del material solo porta la referencia (sceneSpecId); el spec
 * normalizado se lee con sceneRenderer::loadSceneSpec (REST cacheado, el
 * mismo del export). El sampler es shared/sceneSpec::sampleSceneAt dentro de
 * sceneRenderer, así lo que se ve acá cuadro-por-cuadro es literalmente lo
 * que va a salir en el render final.
 *
 * Sin WebGL2 o sin spec → overlay de error EXPLÍCITO: nunca se degrada en
 * silencio (invariante del contrato).
 */
import { useEffect, useRef, useState } from "react";
import { createSceneGLRenderer, getCachedSceneSpec, loadSceneSpec, type SceneGLRenderer } from "../../lib/sceneRenderer";
import { applySceneVariables, type MusaSceneSpec } from "../../../shared/sceneSpec";

interface SceneStage3DProps {
  projectId: string;
  sceneSpecId: string;
  /** Playhead relativo al inicio del segmento, en milisegundos. */
  timeMs: number;
  /** Valores de variables del spec (panel expuesto a la IA); defaults si vacío. */
  variableValues?: Record<string, unknown>;
  selected?: boolean;
  onSelect?: () => void;
}

export function SceneStage3D({ projectId, sceneSpecId, timeMs, variableValues, selected = false, onSelect }: SceneStage3DProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SceneGLRenderer | null>(null);
  const [spec, setSpec] = useState<MusaSceneSpec | null>(() => getCachedSceneSpec(projectId, sceneSpecId));
  const [error, setError] = useState<string | null>(null);
  const [assetWarning, setAssetWarning] = useState<string | null>(null);

  // 1) Cargar el spec normalizado (cache shared con el export).
  useEffect(() => {
    let mounted = true;
    setError(null);
    setSpec(getCachedSceneSpec(projectId, sceneSpecId));
    void loadSceneSpec(projectId, sceneSpecId).then(
      (loaded) => { if (mounted) setSpec(loaded); },
      (cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : `No se pudo cargar el SceneSpec: ${String(cause)}`);
      },
    );
    return () => { mounted = false; };
  }, [projectId, sceneSpecId]);

  // 2) Inicializar el renderer GL + descargar assets (GLB) del spec.
  useEffect(() => {
    if (!spec || rendererRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createSceneGLRenderer(canvas);
    if (!renderer) {
      setError("WebGL2 no está disponible en este navegador. La escena 3D no puede previsualizarse ni exportarse.");
      return;
    }
    rendererRef.current = renderer;
    let mounted = true;
    void renderer.prepare(spec).then((failedIds) => {
      if (mounted && failedIds.length) {
        setAssetWarning(`Assets GLB no cargables: ${failedIds.join(", ")}. Se reportan en fidelity, no se degrada en silencio.`);
      }
    });
    return () => { mounted = false; };
  }, [spec]);

  // 3) Tamaño del canvas al contenedor (dpr acotado a 2, GPU-friendly).
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  // 4) Render por frame: el editor mueve el playhead y re-renderiza el stage.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !spec) return;
    try {
      renderer.render(spec, Math.max(0, timeMs), applySceneVariables(spec, variableValues ?? {}));
    } catch (cause) {
      setError(`Error de render: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [spec, timeMs, variableValues]);

  // El renderer vive en el canvas: al desmontar se suelta el contexto GL.
  useEffect(() => () => {
    rendererRef.current?.dispose();
    rendererRef.current = null;
  }, []);

  return (
    <div ref={wrapRef} className="vp-stage-scene-wrap">
      <canvas
        ref={canvasRef}
        className={selected ? "vp-stage-scene vp-stage-selected" : "vp-stage-scene"}
        onPointerDown={(e) => { e.stopPropagation(); onSelect?.(); }}
      />
      {!spec && !error && <span className="vp-stage-scene-badge" role="status">Cargando escena 3D…</span>}
      {error && <span className="vp-stage-scene-badge vp-stage-scene-error" role="alert">{error}</span>}
      {!error && assetWarning && <span className="vp-stage-scene-badge vp-stage-scene-warn" role="status">{assetWarning}</span>}
    </div>
  );
}
