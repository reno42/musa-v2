# REQ-010 — Modelo de plantillas y archivos en el grafo

Estado: **parcialmente implementado** (ver "Hecho" al final)
Relacionado: [REQ-009](REQ-009-brand-table-merge-and-transfer.md)
Superficie: `api/src/services/brandGraph.ts`, `src/components/BrandGraphCanvas.tsx`,
`src/components/Dashboard.tsx` (pestaña Archivos), Batchamator, chat interno.

## Jerarquía

```
Usuario
 └─ Workspace
     └─ Marca
         ├─ Design System   → frames del archivo design_system_<marca>
         ├─ Plantillas      → frames del archivo plantillas_<marca>
         ├─ Assets          → fotos/archivos en Supabase
         └─ Archivos        → archivos de diseño, se abren en el editor
```

Las cuatro categorías **siempre se muestran**. Si están vacías se muestran como
**fantasma**, para que el sistema sugiera qué falta hacer. Hoy el código las omite
por completo cuando están vacías, que es justo lo contrario.

## Archivos ≠ Plantillas

Un archivo nunca es una plantilla. Son ramas distintas y el contenido bajo cada una
es de distinto tipo:

- Bajo **Archivos** cuelgan archivos, que se abren en el editor.
- Bajo **Plantillas** cuelgan **frames**, no archivos.

El motivo: uno guarda como plantilla *un frame*, no un archivo entero. Por eso
Plantillas necesita un archivo contenedor donde se acumulen esos frames, exactamente
igual que el Design System. Ese archivo es `plantillas_<nombredemarca>`.

Tener el contenedor como archivo real permite además que el usuario copie, pegue o
importe directamente en el editor y eso se convierta en plantilla nueva, apareciendo
en el grafo.

## Qué convierte un frame en plantilla

**Haber pasado por Batchamator al menos una vez.** No es "tener un CSV": el CSV es
un formato de entrada/salida opcional dentro del flujo.

Flujo de Batchamator:

1. Seleccionar un frame.
2. Click en Batchamator.
3. Se abre un panel con una tabla tipo Notion para llenar.
4. Llenar y enviar → se genera todo.
5. ¿Muchos textos? Descargar como CSV.
6. ¿Ya hay un CSV? Subirlo → se genera todo.
7. Imágenes: se puede poner un enlace para traerlas. **Si no hay imagen, se conserva
   la de la plantilla original.**
8. Al completar el proceso al menos una vez, ese frame pasa a ser plantilla.

Una vez que es plantilla se le puede hacer CRUD entrando directamente al archivo
`plantillas_<marca>`. El objetivo de que viva como archivo es que **las IAs lo
reconozcan**.

Si el archivo ya existe, el usuario puede guardarlo con otro nombre o sobrescribirlo.

## Assets y renombre de marca

Los assets se vinculan a la marca por un tag con el nombre de la marca. Al renombrar
una marca:

- Si el tag contenía el nombre viejo, **se reescribe** reemplazando esa palabra.
- Si el tag **no** tenía el nombre de la marca, **se le agrega**, para que empiece a
  reconocerlo.

No se migra a `brand_id`.

## Botón "crear archivo nuevo"

Debe existir en la pestaña **Archivos**. Al crear uno y abrir el editor, el **panel
de información de la derecha se abre por defecto**, para que el usuario:

- actualice el nombre,
- elija a qué marca pertenece (dropdown),
- o agregue una marca nueva desde ahí mismo.

Así el sistema queda ordenado desde el momento de la creación.

## Arrastrar al chat interno

Poder tomar un objeto, texto o frame y arrastrarlo al chat interno. El chat no "ve"
la imagen: obtiene su información estructurada y lo ubica sin ambigüedad.

- Para el usuario: siente que envió el diseño / objeto / frame / jpg.
- Por dentro: la IA recibe "objeto de tal tipo, en tal workspace, estas son sus
  variables", que es contexto que ya recibía, pero ahora anclado a un referente exacto.
- Beneficio: elimina la ambigüedad sobre a qué archivo se refiere y **economiza tokens**.

## Esquema requerido (v21, NO aplicada)

Simétrico a lo que v20 hizo para el Design System:

| v20 (Design System) | v21 (Plantillas) |
|---|---|
| `brand_guidelines.design_system_template_id` | `brand_guidelines.template_library_template_id` |
| `templates.is_brand_manual` | `templates.is_template_library` |

Con eso, el código que hoy extrae los frames del Design System sirve tal cual para
Plantillas.

Además hace falta marcar qué frames ya pasaron por Batchamator. La tabla `batch_jobs`
ya existe (v3/v9) y puede ser la fuente de verdad, o bien un flag en el frame.

## Hecho

- Las cuatro categorías se emiten siempre, con nodo fantasma cuando están vacías.
- Se eliminó la doble renderización: antes Plantillas y Archivos recorrían el mismo
  array `nonDsTemplates`, emitiendo el mismo id `tpl:<id>` dos veces, lo que rompía
  el `byId` del canvas. Ahora Archivos es la única rama que lista archivos, y
  Plantillas queda fantasma hasta que exista `plantillas_<marca>`.

## Pendiente

- v21 y el archivo `plantillas_<marca>`.
- Promoción de frame a plantilla al completar Batchamator.
- Reescritura/agregado de tags de assets al renombrar marca.
- Botón "crear archivo nuevo" + apertura del panel de información.
- Arrastrar objeto/frame al chat.
