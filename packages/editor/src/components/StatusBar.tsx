import type { LayerInfo } from "../hooks/useCanvas";

interface Props {
  layerCount: number;
  selectedLayer: LayerInfo | null;
  zoom: number;
  canvasSize: { width: number; height: number };
}

export function StatusBar({ layerCount, selectedLayer, zoom, canvasSize }: Props) {
  return (
    <div className="status-bar">
      <span className="status-item">{canvasSize.width}×{canvasSize.height}</span>
      <span className="status-item">{Math.round(zoom * 100)}%</span>
      <span className="status-item">{layerCount} layers</span>
      {selectedLayer && (
        <span className="status-item">▸ {selectedLayer.name}</span>
      )}
      <span className="status-spacer" />
      <span className="status-item">Futuraria Design</span>
    </div>
  );
}
