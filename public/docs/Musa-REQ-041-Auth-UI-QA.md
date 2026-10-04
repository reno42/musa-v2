# REQ-041 — QA UI Autenticación: registro y acciones de confirmación

Fecha: 2026-09-30
Módulo: Autenticación (entrada, registro y recuperación)
Estado: Encontrado en prueba de navegador; pendiente de implementación

## Bug confirmado — P1: “Reenviar correo de confirmación” aparece antes de crear la cuenta

### Evidencia
- `src/components/AuthScreen.tsx:202` renderiza el botón cuando `mode === "signup" && email`.
- El formulario conserva el correo del modo de inicio de sesión al cambiar a registro.
- No exige que exista un intento de registro exitoso ni que se haya mostrado el mensaje de confirmación.

### Reproducción en navegador
1. Abrir `http://localhost:5173/`.
2. Entrar al workspace para abrir la pantalla de acceso.
3. Con un correo ya presente en el campo, cambiar a “¿Nuevo aquí? Crea una cuenta”.
4. Se muestra “Reenviar correo de confirmación” aunque todavía no se creó ninguna cuenta ni se envió correo.

### Impacto
La acción parece disponible, pero puede fallar o enviar una confirmación para un registro que nunca ocurrió. Confunde el flujo y hace difícil distinguir “crear cuenta” de “reenviar confirmación”.

### Requerimiento
- Mostrar “Reenviar correo de confirmación” solo después de que el signup haya terminado correctamente y Supabase haya devuelto que no hay sesión.
- Al cambiar de modo, conservar el correo si ayuda al usuario, pero ocultar el botón de reenvío hasta que exista `signupPendingConfirmation`.
- Si el reenvío falla, mostrar un error accesible y mantener el estado del formulario.

### Criterios de aceptación
- En un registro nuevo el botón no aparece antes de enviar el formulario.
- Después de un signup exitoso sin sesión, aparece el botón y reenvía al correo correcto.
- Cambiar entre iniciar sesión/registrarse no muestra acciones de confirmación obsoletas.
- La acción sigue siendo accesible por teclado y lector de pantalla.

## Cobertura observada
- Inicio de sesión por correo: pantalla, campos y CTA visibles.
- Registro: pantalla y campos visibles; se detectó el bug anterior.
- Google OAuth y recuperación: no se ejecutaron porque requieren una cuenta/acción externa.
