# REQ-009 — Tabla de marcas: fusión por renombre y transferencia al eliminar

Estado: **especificado, no implementado**
Depende de: `supabase_migrations_v20.sql` aplicada (aporta `brand_guidelines.deleted_at`
y `design_system_template_id`).
Superficie: `src/components/BrandGraphDataTable.tsx`, `src/components/BrandGraphCanvas.tsx`,
`api/src/services/brands.ts`, `api/src/services/brandGraph.ts`.

## Forma de la tabla

Tabla tipo Notion, editable en línea, alineada con el grafo (misma fuente de datos).

| columna | contenido | comportamiento |
|---|---|---|
| Marca | nombre de la marca | editable; ver reglas de nombre |
| Categoría | `design system` · `asset` · `template` · `archivo` | editable |
| Nombre del archivo | nombre del archivo | **clickeable** → abre popup con el editor cargado con ese archivo |

Se pueden agregar filas nuevas y rellenarlas libremente.

## Reglas de nombre de marca

Son **dos reglas distintas** según la operación. No confundirlas:

- **Crear** una marca con un nombre que ya existe → **se bloquea**. El sistema avisa
  que ya existe y pide probar con otro nombre. No fusiona.
- **Editar** el nombre de una marca existente hasta que coincida con otra → **fusiona**.
  El sistema avisa primero que va a fusionar todo dentro de una misma marca, y al
  confirmar reacomoda los archivos bajo la marca resultante.

La fusión es una **reasignación de archivos**, no un merge campo por campo: los
archivos de ambas marcas pasan a colgar de una sola. La columna Categoría se
mantiene tal cual, porque las categorías son las mismas, solo que ahora bajo una
única marca.

Al fusionar, los archivos de las dos marcas **se suman todos** (no se pierde
ninguno) y la tabla **marca visualmente los repetidos** — los que aparecían en
ambas marcas — para que el usuario los revise.

## Nombres de archivo

Los nombres de archivo **no se pueden repetir**.

## Creación de marca

Al crear una marca nueva se crea **automáticamente su archivo de Design System**.

## Eliminación de marca

Al eliminar una marca, ofrecer explícitamente las dos salidas:

1. **Eliminar todo** — design system, assets, archivos y demás.
2. **Transferir a tu marca** — todo pasa a la marca propia del usuario (Futuraria
   por defecto).

En el caso de transferencia, cada archivo transferido se renombra con el sufijo
`_nombredelamarcadedondevienen`, para evitar choques de nomenclatura con la regla
de "nombres de archivo no repetidos" y para conservar la trazabilidad de origen.

## Notas de implementación

- La regla de sufijo al transferir y la regla de nombres únicos interactúan: el
  sufijo es justamente lo que permite que la transferencia no viole la unicidad.
  Aplicar el sufijo *antes* de validar unicidad.
- La fusión por renombre y la transferencia por borrado terminan en la misma
  operación de bajo nivel (reasignar `brand_id` de un conjunto de archivos); vale
  la pena una sola función compartida.
