const LARGE_IMAGE_BYTES = 1.5 * 1024 * 1024;
const LOCAL_STORAGE_WARNING_BYTES = 4 * 1024 * 1024;

function localStorageBytes(): number {
  let characters = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) || "";
    characters += key.length + (localStorage.getItem(key)?.length || 0);
  }
  return characters * 2;
}

export function imageStorageWarning(file: File): string | null {
  const projectedBytes = localStorageBytes() + Math.ceil(file.size * 4 / 3) * 2;
  if (file.size < LARGE_IMAGE_BYTES && projectedBytes < LOCAL_STORAGE_WARNING_BYTES) return null;

  const sizeMb = (file.size / 1024 / 1024).toFixed(1);
  return `La imagen pesa ${sizeMb} MB. Se puede subir, pero una copia incrustada podría superar el respaldo local del navegador. Mantén el servidor sincronizado y evita cerrar la pestaña hasta ver el estado guardado.`;
}
