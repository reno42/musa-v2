# Logica de Arquitectura — Futuraria Design

> Fuente de verdad para la nomenclatura, jerarquia de datos y orden de ejecucion.
> Ultima actualizacion: v12 (commercial intelligence schema).

---

## 1. Jerarquia de entidades (orden de creacion en DB)

```
auth.users (Supabase)
  └── workspace_members (rol: owner | admin | editor | viewer)
        └── workspaces
              ├── brands (relationship_status: lead | client)
              │     ├── crm_contacts (1+ personas por marca)
              │     ├── campaigns (campaign_type, brief)
              │     │     └── design_file_meta (assets por campaña)
              │     └── design_file_meta (assets directos de marca)
              ├── design_file_meta (assets sin marca)
              ├── suppliers (proveedores / imprentas)
              └── playbooks (plantillas de estrategia replicables)
```

### Orden exacto de creacion cuando entra un usuario nuevo

1. **Supabase Auth** crea el usuario en `auth.users`.
2. **Trigger `handle_new_futuraria_user()`** (v11) crea:
   - Un workspace personal (`Mi Workspace`).
   - Un registro en `workspace_members` con rol `owner`.
3. **`POST /api/account/bootstrap`** ejecuta:
   - `claimLegacyWorkspacesForInitialUser()` — transfiere workspaces huerfanos al primer usuario (si `SAAS_INITIAL_OWNER_EMAIL` esta configurado).
   - `ensurePersonalWorkspace()` — garantiza que el workspace personal exista.
4. El usuario ya puede crear **archivos** (templates) dentro de su workspace.

---

## 2. Nomenclatura corregida

### Tablas vs. conceptos

| Concepto del usuario | Nombre en DB | UI label | Notas |
|---|---|---|---|
| Archivo de diseno | `templates` | "Archivos" | NO usar "Templates" en la UI — un template es un archivo reutilizable como punto de partida (futura feature) |
| Metadata del archivo | `design_file_meta` | — | Una fila por cada `template_id` |
| Marca / negocio | `brands` | "Marca" | `relationship_status`: `lead` o `client` |
| Contacto (CRM) | `crm_contacts` | "Contacto" | Varias personas por marca |
| Campaa | `campaigns` | "Campaa" | Tipada con `campaign_type` |
| Asset | `design_file_meta.asset_type` | "Tipo de asset" | Taxonomia completa ver seccion 3 |
| Perfil de diseno | `design_file_meta.designer_type` | "Perfil de diseno" | `digital`, `print`, `ux_ui`, `brander`, `spatial`, `editorial`, `other` |
| Proveedor / imprenta | `suppliers` | "Proveedor" | Nodo en el graph con especialidad y capacidades |
| Playbook | `playbooks` | "Playbook" | Plantilla de estrategia replicable |
| Activo permanente | `design_file_meta.is_permanent` | "Activo permanente" | Lineamientos de marca, design system, brand book |

### Reglas de nomenclatura

- **Todo en espanol en la UI.** Excepciones: terminos tecnicos estandarizados (Design System, Key Visual, Deck, Dashboard, Landing, POP).
- **Todo en ingles (snake_case) en DB y API.** Esto incluye enum values (`social_media`, `key_visual`, etc.).
- **El mapeo ingles-espanol** vive en `ASSET_TYPE_OPTIONS` y `DESIGNER_TYPE_OPTIONS` en `src/lib/designGraph.ts`.
- **El dropdown en FileInfoPanel** agrupa por `group` (Core, Digital, Produccion, UX-UI, Brand, Espacial, Editorial, Permanentes).

---

## 3. Taxonomia completa de asset_type

Agrupada por perfil de diseno (designer_type):

### Core (todos los perfiles)
| value | label |
|---|---|
| `key_visual` | Key visual |
| `social_media` | Social media |
| `web` | Web |
| `mailing` | Mailing |
| `other` | Otro |

### Digital / Performance (designer_type: `digital`)
| value | label |
|---|---|
| `landing` | Landing page |
| `ecommerce` | E-commerce (PDP/PLP) |
| `display_ads` | Display ads |
| `motion` | Motion / video |
| `app_store` | App store assets |
| `whatsapp_template` | Plantilla WhatsApp |
| `deck` | Deck / presentacion |

### Produccion / Impresion (designer_type: `print`)
| value | label |
|---|---|
| `packaging` | Empaque |
| `label` | Etiqueta |
| `dieline` | Dieline |
| `pop_display` | POP / exhibidor |
| `large_format` | Gran formato |
| `signage` | Senaletica |
| `textile` | Textil |
| `merch` | Merchandising |
| `stand` | Stand |

### UX / UI (designer_type: `ux_ui`)
| value | label |
|---|---|
| `design_system` | Design system |
| `component` | Componente |
| `prototype` | Prototipo |
| `dashboard` | Dashboard |

### Brand (designer_type: `brander`)
| value | label |
|---|---|
| `brand_identity` | Identidad de marca |
| `brand_book` | Brand book / manual |
| `naming` | Naming |
| `iconography` | Iconografia |
| `illustration` | Ilustracion |
| `art_direction` | Direccion de arte |
| `papeleria` | Papeleria |

### Espacial (designer_type: `spatial`)
| value | label |
|---|---|
| `wayfinding` | Wayfinding |
| `retail` | Retail |
| `activation` | Activacion |
| `scenography` | Escenografia |

### Editorial (designer_type: `editorial`)
| value | label |
|---|---|
| `catalog` | Catalogo |
| `report` | Memoria / reporte |
| `infographic` | Infografia |
| `whitepaper` | Whitepaper |

### Permanentes (is_permanent = true)
| value | label |
|---|---|
| `permanent_asset` | Activo permanente |

---

## 4. Production data (solo para assets de produccion)

Cuando `designer_type = "print"` o el `asset_type` esta en la categoria Produccion, FileInfoPanel muestra campos de produccion que se guardan en el JSONB `production_data`:

| key | label UI |
|---|---|
| `supplier` | Proveedor / imprenta |
| `print_run` | Tiraje (cantidad) |
| `substrate` | Sustrato (papel, vinilo, tela...) |
| `finish` | Acabados (laminado, UV, hot-stamp) |
| `technique` | Tecnica (offset, flexo, serigrafia, digital) |
| `color_mode` | Color (CMYK, Pantone) |
| `unit_cost` | Costo unitario |
| `turnaround` | Tiempo de produccion |
| `approved_version` | Version aprobada |

---

## 5. Tipos de campana (campaign_type)

| value | descripcion |
|---|---|
| `launch` | Lanzamiento desde cero |
| `relaunch` | Relanzamiento de marca |
| `seasonal` | Fiestas patrias, navidad, etc. |
| `cobranding` | Campana conjunta con otra marca |
| `nurturing` | Secuencia de nurturing de leads |
| `event` | Congreso, feria, activacion |
| `retention` | Retencion / fidelizacion |
| `general` | Iniciativa general (default) |

---

## 6. Graph (vista Obsidian)

### Jerarquia visual

```
Workspace
  ├── [Lead] Marca A
  │     ├── Contacto 1, Contacto 2
  │     ├── Campana "Black Friday 2026"
  │     │     ├── [asset_type] Archivo 1
  │     │     └── [asset_type] Archivo 2
  │     └── [asset_type] Archivo directo (sin campana)
  └── [Client] Marca B
        └── ...
```

### Colores
- **Lead** = un color (ej. azul)
- **Client** = otro color (ej. verde)
- **Asset type** = color por categoria (Core, Digital, Produccion, etc.)

### Filtros disponibles
- Por marca (texto)
- Por tag
- Por formato (web, mobile, social, print, email, packaging, large_format, signage, textile)
- Por perfil de diseno (designer_type)
- Vista: todos / solo leads / solo clientes
- Mostrar/ocultar personas

---

## 7. Orden de migraciones SQL (ejecutar en orden)

| Version | Archivo | Que hace |
|---|---|---|
| v3 | `supabase_migrations_v3.sql` | Schema base: templates, workspaces, design_file_meta |
| v4 | `supabase_migrations_v4.sql` | API keys por workspace |
| v9 | `supabase_migrations_v9.sql` | SaaS tenancy: workspace_members, RLS, roles |
| v10 | `supabase_migrations_v10.sql` | CRM: brands, campaigns, crm_contacts |
| v11 | `supabase_migrations_v11.sql` | Personal workspace trigger, invitations |
| **v12** | `supabase_migrations_v12.sql` | **Commercial intelligence: expand asset_type, designer_type, is_permanent, production_data, suppliers, playbooks, campaign brief** |

### Para ejecutar v12

```sql
-- Ejecutar en Supabase SQL Editor en orden:
-- 1. supabase_migrations_v12.sql (este archivo)
-- Es idempotente: seguro de re-ejecutar.
```

---

## 8. Secciones de la herramienta (menu hamburguesa)

El menu hamburguesa (visible en todas las resoluciones) contiene:

| Seccion | Tab ID | Descripcion |
|---|---|---|
| Archivos | `templates` | Lista de archivos/disenos del workspace |
| Textos | `texts` | Banco de copys y textos |
| Key Visuals | `recipes` | Plantillas reutilizables de key visuals |
| Storage | `storage` | Gestion de almacenamiento e imagenes |
| Configuracion | `settings` | API keys, preferencias, cuenta |
| Workspace | `workspace` | Gestion de workspace, miembros, invitaciones |
| Graph | `graph` | Vista tipo Obsidian de marcas, campañas y assets |

### Secciones futuras planeadas (no implementadas aun)
- **CRM** — gestion de contactos con nurturing flows
- **Funnel** — vista tipo funelytics de canales digitales
- **Playbooks** — biblioteca de estrategias replicables
- **Suppliers** — directorio de proveedores/imprentas
