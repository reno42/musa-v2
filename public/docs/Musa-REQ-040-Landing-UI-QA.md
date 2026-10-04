# REQ-040 — QA UI Landing pública: hero dependiente del video

Fecha: 2026-09-30
Módulo: Landing pública
Estado: Encontrado en prueba de navegador; pendiente de implementación

## Contexto
La landing debe poder explicar Musa y ofrecer el CTA principal aunque el video decorativo tarde, falle, no tenga soporte de códec o el navegador bloquee autoplay.

## Bug confirmado — P0: el contenido principal depende de `canplay`

### Evidencia
- `src/components/Landing.tsx:209` inicializa `videoReady` en `false`.
- `src/components/Landing.tsx:253-255` solo cambia ese estado desde `handleCanPlay`.
- `src/components/Landing.tsx:526` renderiza título, descripción y CTA únicamente dentro de `{videoReady && (...)}`.
- `src/components/Landing.tsx:296` carga `/animated-bg.mp4` sin fallback de error.

### Reproducción en navegador
1. Abrir `http://localhost:5173/`.
2. Observar el primer render antes de que el video emita `canplay`, o bloquear/fallar `/animated-bg.mp4`.
3. El hero queda negro o sin título/CTA; la accesibilidad reporta que no se pudo reproducir el contenido multimedia.
4. El contenido aparece solo después de que el video logra cargar.

### Impacto
Un visitante puede ver una pantalla vacía y no entender qué es Musa ni cómo empezar. El CTA central puede desaparecer indefinidamente si el recurso multimedia falla.

### Requerimiento
- Renderizar siempre el título, descripción y CTA desde el primer render.
- Tratar el video como decoración no crítica.
- Añadir estado de error y fallback visual estático.
- Añadir `poster` y `aria-hidden="true"` al video.
- El CTA debe seguir funcionando con video bloqueado, lento o ausente.

### Criterios de aceptación
- Con `/animated-bg.mp4` bloqueado, el hero muestra título, descripción y CTA en menos de un frame.
- Con autoplay bloqueado, el CTA navega igualmente a `#workspace`.
- No aparece el mensaje de medio fallido en el árbol accesible.
- Se conserva una imagen/fondo estático cuando el video no está disponible.

## Bug relacionado — P1: video sin `poster` ni fallback

`Landing.tsx:296` y `Dashboard.tsx:2054` usan autoplay sin `poster` ni `onError`. En red lenta o códec incompatible aparece una región vacía/negra e inestable.

### Criterios de aceptación
- Ambos videos tienen `poster` o fallback de fondo.
- `onError` desactiva el intento de reproducción y no bloquea la interfaz.
- El video decorativo no se expone como contenido funcional al lector de pantalla.
