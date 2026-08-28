# REQ-019 — Recetas humanas, marcas desde el editor y acciones visibles

**Fecha:** 2026-08-28 · **Estado:** implementado

## Problema

1. **Recetas inalcanzables como humano.** El menú "Ir a → Recetas" del editor
   caía en el tab `recipes` del dashboard — que es la grilla de **Key Visuals**
   (tabla `recipes`, html+css), no las recetas de copywriting. Ahí no hay nada
   que un humano pueda agregar; el panel con la fila "+ Agregar"
   (`CopyRecipesTab`, tabla `copy_recipes`) vive dentro de Copywriting →
   Recetas. Era un dead-end de routing, no un bug de datos: la tabla y el
   REST existen y responden (verificado contra PostgREST en producción).
2. **Marcas solo de lectura en el panel de información.** El campo Marca del
   panel contextual (tab Información del editor) era un `<select>` cerrado:
   para dar de alta una marca nueva había que ir a la tabla de marcas. Además,
   el PUT de `/api/meta/:id` resolvía nombres y creaba marcas faltantes solo
   cuando el body NO traía `brand_id`; el panel envía el objeto completo con
   `brand_id: null`, así que un nombre tipeado quedaba como texto suelto y el
   archivo nunca cambiaba de marca.
3. **Acciones de tarjeta invisibles.** En Diseño → Archivos, los tres puntos
   (duplicar/eliminar/info) tenían `opacity: 0` hasta hover y texto casi
   transparente, y el dropdown usaba `liquid-glass` (vidrio translúcido sobre
   covers claros) con texto blanco → blanco sobre blanco.

## Solución

1. **Routing:** `EDITOR_NAV_TABS` acepta un `pane` opcional; "Recetas" ahora
   navega a `copywriting` + pane `recipes` (`dashboardInitialPane`). El
   dashboard baja su `activePane` al `ContentTab` como `paneHint`, que aplica
   el pane pedido sin pisar los clicks propios del usuario.
2. **Marcas:** Marca pasó de select a combobox (input + datalist con las
   marcas existentes). Un nombre nuevo se crea al guardar: la ruta ahora
   resuelve nombres siempre que `brand_id` no venga truthy (`!patch.brand_id`
   cubre `null` y `undefined`). Contrato idéntico al campo Campaña.
3. **Acciones visibles:** `.dash-card-actions` dejó de ocultarse hasta hover
   (CSS); los botones `···` de las dos variantes de tarjeta y los
   Crear/Eliminar de Key Visuals son chips oscuros con borde y texto claro; el
   dropdown es panel sólido oscuro (`rgba(10,12,18,0.97)`) con sombra.

## Archivos

- `src/pages/EditorV2.tsx` — `EDITOR_NAV_TABS` con pane + onClick.
- `src/components/Dashboard.tsx` — `paneHint` al ContentTab; chips y dropdowns.
- `src/components/ContentTab.tsx` — prop `paneHint` + efecto.
- `src/components/FileInfoPanel.tsx` — Marca combobox.
- `api/src/routes/designMeta.ts` — condición de resolución de marca.
- `src/index.css` — acciones de tarjeta siempre visibles.

## Verificación

- `npm run build` verde (tsc + vite).
- Producción: menú del editor → Recetas aterriza en Copywriting → Recetas;
  escribir una marca nueva en Información la crea y el archivo queda grabado
  a ella; en Archivos los tres puntos y su menú se ven sin hover.
