# NDA / Acuerdo de Acceso Alfa — integración en creación de cuenta

Carpeta independiente con el paso de aceptación del acuerdo al crear la cuenta.
**No está integrada al editor a propósito**: es para que el agente del IDE la
cablee en el flujo de registro existente.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `NdaAcceptance.tsx` | Componente React del paso de aceptación (plan + NDA + checkbox + botón). Autónomo, estilos inline. |
| `ndaContent.ts` | Texto del acuerdo (9 cláusulas), opciones de plan y datos de Supabase. |
| `migration.sql` | Crea la tabla `nda_acceptances` + RLS. **Se corre aparte, en el Supabase del CRM.** |

## Antes de integrar (obligatorio)

1. Correr `migration.sql` en el **Supabase del CRM** (`unhiumdpcywchtsykakj`), no en el del editor.
2. Verificar que la tabla exista: si el POST devuelve `PGRST205` / "Could not find the table", falta correr la migración.

## Datos de destino (importante: es OTRO Supabase)

- URL: `https://unhiumdpcywchtsykakj.supabase.co`
- Tabla: `nda_acceptances`
- Key (publishable, cliente-safe): `sb_publishable_doHxQZ-tzKJzmwri6YcRlQ_9rUHEQXz`
- RLS: anon solo INSERTA (no lee). Por eso el POST va directo desde el cliente, sin auth.

El editor tiene su propio Supabase (`qqqcmtwzyaejlzffivri`). **No** escribas la
aceptación ahí: este componente ya apunta al del CRM con `fetch` directo.

## Cómo integrarlo

Es un paso previo a completar el alta. Ejemplo de uso en el flujo de registro:

```tsx
import { NdaAcceptance } from '../nda-acceso-alfa/NdaAcceptance';

// Dentro del componente de registro, tras capturar nombre + email:
if (!ndAceptado) {
  return (
    <NdaAcceptance
      fullName={form.fullName}
      email={form.email}
      onAccepted={({ plan }) => {
        setNdaAceptado(true);
        setPlan(plan);            // guarda 'friends_family' | 'corporate' en la cuenta
        continuarAlta();          // crea la cuenta / workspace
      }}
      onCancel={() => volverAlLogin()}
    />
  );
}
```

Reglas:
- **No crear la cuenta** hasta que `onAccepted` se dispare (solo se dispara tras insertar en Supabase con éxito).
- Guardar `plan` en la entidad de usuario/workspace del editor (campo nuevo o `metadata`).
- Adaptar los estilos inline al design system del editor (lime `#d2ff02`, violeta `#854be8`, fondo oscuro).

## Campos que guarda la tabla

`full_name`, `email`, `plan` (`friends_family` | `corporate`), `accepted_at`,
`ip_address`, `user_agent`, `version`.

## Notas

- La key publishable ya es pública (está en el bundle del CRM); no es un secreto.
- Si un día se necesita leer las aceptaciones: se hace desde el CRM con la secret key (no desde el cliente).
- El texto del acuerdo está duplicado en la landing pública (`https://futuraria-nda.netlify.app`) y aquí. Si editas las cláusulas, actualiza ambos para mantener consistencia.
