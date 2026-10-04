# Dogfood QA — Copywriting de Musa

Fecha: 2026-09-24  
Cuenta: Renzo Perez Bartra  
URL base: https://design.futuraria.com/#workspace/copywriting  
Método: exploración exclusivamente por UI visible en el navegador autenticado. No se usaron MCP, API, curl, deploy, wrangler ni repositorios.

## Resumen ejecutivo

- Bugs funcionales/UX nuevos: **2** (1 Medio, 1 Alto).
- Advertencia de consola reproducible: **1** (Medio, Consola).
- Bloqueo externo visible en el panel Ghost: DeepSeek 401 y `res.send is not a function` ya estaban en el historial de la sesión; se registran como contexto, no como bug nuevo del módulo Copywriting.
- Datos QA creados: una pieza `QA_Copywriting_Pieza` y recetas `QA_Receta_*`. La UI no eliminó las recetas al pulsar `×`; queda documentado como parte del hallazgo y no se volvió a tocar información no-QA.

## Bugs ordenados por severidad

### CW-001 — El botón “+” crea una pieza vacía sin formulario ni confirmación

- Severidad: **Medio**
- Categoría: Funcional / UX
- URL: `https://design.futuraria.com/#workspace/copywriting`
- Pasos:
  1. Abrir la pestaña **Calendario**.
  2. Pulsar el primer botón `+` de un día.
  3. Observar el contador y la pieza nueva.
- Esperado: abrir un formulario de nueva pieza o crearla sólo después de confirmar datos mínimos.
- Obtenido: la acción crea inmediatamente una pieza con tema `(sin tema)`; el contador pasó de 48 a 49. La pieza queda persistida aunque no se haya introducido contenido.
- Consola: sin error JS al reproducirlo.
- Evidencia: captura de Calendario tomada durante la sesión; la herramienta UI no expone ruta de archivo para guardar PNG.

### CW-002 — Eliminar recetas QA con “×” no tiene efecto observable

- Severidad: **Alto**
- Categoría: Funcional / Datos
- URL: `https://design.futuraria.com/#workspace/copywriting` (pestaña Recetas)
- Pasos:
  1. Abrir **Recetas**.
  2. Crear recetas con nombres `QA_Receta_Framework`, `QA_Receta_Tono` y `QA_Receta_Hook`.
  3. Pulsar el botón `×` de una receta QA y esperar más de 2 s; repetir con otra.
  4. Recargar la vista con `⟳ Recargar`/cambiar de pestaña y volver.
- Esperado: eliminar la receta QA y actualizar el contador/listado.
- Obtenido: las filas permanecen y el contador se mantiene en 14 recetas; no aparece confirmación, error ni feedback. Esto impidió dejar sólo una receta QA como pedía la prueba sin arriesgar datos no-QA.
- Consola: sin error JS asociado al click.
- Evidencia: listado de Recetas con las cuatro filas `QA_Receta_*` persistentes.

### CW-003 — Runtime de intentRouter no disponible (warning silencioso)

- Severidad: **Medio**
- Categoría: Consola / Funcional potencial
- URL: `https://design.futuraria.com/#workspace/copywriting` (transición a Bandeja/Calendario)
- Pasos:
  1. Navegar entre las pestañas del módulo.
  2. Abrir consola del navegador y filtrar warnings.
- Esperado: sin warnings de inicialización que desactiven una capacidad del producto.
- Obtenido: warning reproducible:

  ```text
  [intentRouter] runtime no disponible — router desactivado en esta sesión: Can't create a session. ERROR_CODE: 7, ERROR_MESSAGE: Failed to load model because protobuf parsing failed.
  ```

  El flujo Copywriting básico sigue cargando, pero el router de intents queda desactivado.

## Cobertura ejecutada

| Área | Cobertura | Resultado |
|---|---|---|
| Calendario | Carga, contador, +, abrir detalle, edición de pieza QA, mes siguiente/anterior, Hoy visible, filtro Instagram | Carga correcta; CW-001 |
| Contenidos | Tabla editable, búsqueda por campaña (`QA_Campaña`), filtros, persistencia de pieza QA | Correcto; botón Limpiar fue inestable en una interacción (no confirmado como bug) |
| Reportes | Agrupación por campaña, total, QA_Campaña, export CSV/Excel visibles | Carga correcta; métricas en cero son coherentes con datos sin resultados |
| Atribución | Estados Directa/Asistida/Correlación, espera de carga | Mensaje vacío correcto: “Aún no hay señales atribuidas” |
| Copys | Carga, filtros de marca/campaña, búsqueda sin resultados | Correcto; sincronización inicialmente muestra loading y luego lista |
| Recetas | Filtro de tipo, creación de QA Framework/Tono/Hook, delete `×` | CW-002 |
| Bandeja | Carga 0→4 conversaciones, filtro Solo comentarios, respuesta vacía/deshabilitada y con texto habilitada | Correcto; no se enviaron mensajes |
| Consola | Logs tras transiciones | CW-003; Ghost conserva 401/500 históricos fuera del módulo |

## Integrator cycle

- Landing/login: no repetido; sesión ya autenticada.
- Dashboard: recorrido previo disponible; no se modificaron datos fuera de QA.
- Copywriting completo: recorrido realizado.
- UI destructiva: sólo se intentó eliminar datos con prefijo `QA_`; la UI no produjo eliminación observable.
- No se ejecutaron publicaciones, respuestas sociales, importaciones, exportaciones descargables ni acciones externas representacionales.

## Qué no se probó y por qué

- Publicar/responder/capturar CRM: requiere acción externa representacional; se verificó habilitación del botón sin enviar.
- Importar/exportar archivos: no se disparó descarga ni mutación externa en una prueba sólo lectura.
- Drag de una pieza: no se ejecutó para no reprogramar accidentalmente una pieza no-QA.
- Login/registro/recuperar contraseña: fuera del módulo solicitado y había sesión autenticada.
- Resize/back-forward y casos de carga masiva: limitación de tiempo y para no salir de la sesión autenticada.

## Cinco arreglos prioritarios

1. Hacer que `+` abra un formulario/modal y no persista hasta validar tema/fecha (CW-001).
2. Reparar el handler de borrado de recetas, manejar respuesta del backend y mostrar confirmación/error (CW-002).
3. Corregir la carga del runtime de `intentRouter`/protobuf y añadir fallback visible (CW-003).
4. Añadir feedback de guardado/eliminación en todas las tablas editables y evitar estados de carga infinitos.
5. Separar claramente acciones representacionales (publicar, responder, capturar CRM) con confirmación y estado de éxito/error.

