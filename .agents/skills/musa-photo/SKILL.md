---
name: musa-photo
description: Retocar, separar, optimizar o generar variantes de imágenes en Musa. Úsalo para fotos y assets; no para diseñar piezas completas desde cero.
---

# Foto en Musa

Identifica el asset de partida (o búscalo en stock si no existe), la operación pedida y el destino del resultado. Trabaja en una sesión de foto por imagen y agrupa operaciones sobre la misma base: variante, recorte, fondo, máscara u optimización. Los cambios destructivos van sobre una variante, nunca sobre el original sin confirmación.

Aplica una operación por paso y verifica el resultado visual antes de encadenar la siguiente; si una separación de capas o una máscara queda mal, corrige ahí en vez de acumular errores. Exporta o sube el asset final y comunica su id o URL. Si el resultado alimenta un diseño, entrega a `musa-design` la URL del asset, no el archivo local.

## Ejemplos

- "Quítale el fondo a esta foto del producto y déjala en PNG transparente"
- "Genera 3 variantes de esta foto: blanco y negro, cálida y alto contraste"
- "Optimiza esta imagen para web sin que se note la pérdida de calidad"
