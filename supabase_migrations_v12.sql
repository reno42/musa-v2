-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Migration v12: Commercial intelligence schema
-- Expand asset taxonomy, add designer_type, brief, production data,
-- suppliers, playbooks, and is_permanent flag.
-- Apply after v11. Idempotent and safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. EXPAND asset_type CHECK constraint on design_file_meta
-- ============================================================
-- Drop the old v10 constraint (only 5 values) and replace with the
-- full taxonomy covering all designer profiles described in the
-- architecture document.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_file_meta_asset_type_check'
  ) THEN
    ALTER TABLE design_file_meta DROP CONSTRAINT design_file_meta_asset_type_check;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_file_meta_asset_type_check'
  ) THEN
    ALTER TABLE design_file_meta ADD CONSTRAINT design_file_meta_asset_type_check
      CHECK (asset_type IN (
        -- Core
        'key_visual', 'social_media', 'web', 'mailing', 'other',
        -- Digital / performance
        'landing', 'ecommerce', 'display_ads', 'motion', 'app_store',
        'whatsapp_template', 'deck',
        -- Print / production
        'packaging', 'label', 'dieline', 'pop_display', 'large_format',
        'signage', 'textile', 'merch', 'stand',
        -- UX / UI
        'design_system', 'component', 'prototype', 'dashboard',
        -- Brand
        'brand_identity', 'brand_book', 'naming', 'iconography',
        'illustration', 'art_direction', 'papeleria',
        -- Spatial
        'wayfinding', 'retail', 'activation', 'scenography',
        -- Editorial
        'catalog', 'report', 'infographic', 'whitepaper',
        -- Permanent assets (lineamientos de marca)
        'permanent_asset'
      ));
  END IF;
END $$;

-- ============================================================
-- 2. designer_type — perfil del diseñador / rama de la industria
-- ============================================================
-- Permite a la IA y al humano etiquetar qué tipo de diseñador
-- produce este asset, para encontrar patrones por rubro.
ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS designer_type TEXT NOT NULL DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_file_meta_designer_type_check'
  ) THEN
    ALTER TABLE design_file_meta ADD CONSTRAINT design_file_meta_designer_type_check
      CHECK (designer_type IN (
        'digital', 'print', 'ux_ui', 'brander', 'spatial', 'editorial', 'other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dfm_designer_type ON design_file_meta(designer_type);

-- ============================================================
-- 3. is_permanent — separa activos permanentes de campaña
-- ============================================================
-- Los activos permanentes (lineamientos de marca, manuales,
-- tokens de design system) no pertenecen a ninguna campaña
-- específica. Es una categoría aparte según el doc.
ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_dfm_is_permanent ON design_file_meta(workspace_id, is_permanent);

-- ============================================================
-- 4. production_data — atributos de impresión/producción
-- ============================================================
-- JSONB flexible para proveedor, tiraje, sustrato, acabados,
-- técnica, Pantone vs CMYK, costo, tiempo, versión aprobada.
ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS production_data JSONB DEFAULT '{}';

-- ============================================================
-- 5. campaign brief — un párrafo describiendo la estrategia
-- ============================================================
-- Reemplaza "datos que predicen venta" con un brief entendible
-- del porqué el cliente pide esto y qué estrategia responde.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brief TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'general';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_campaign_type_check'
  ) THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_type_check
      CHECK (campaign_type IN (
        'launch',           -- lanzamiento desde cero
        'relaunch',         -- relanzamiento de marca
        'seasonal',         -- fiestas patrias, navidad, etc.
        'cobranding',       -- campaña conjunta con otra marca
        'nurturing',        -- secuencia de nurturing de leads
        'event',            -- congreso, feria, activación
        'retention',        -- retención / fidelización
        'general'           -- iniciativa general
      ));
  END IF;
END $$;

-- ============================================================
-- 6. suppliers — proveedores como nodos en el graph
-- ============================================================
-- Cada proveedor/imprenta con su especialidad, contacto,
-- acabados y tiempos. Permite saber qué imprenta para
-- qué acabado, con qué margen y qué tiempos.
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY DEFAULT ('supplier_' || substr(md5(random()::text), 1, 20)),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT 'print' CHECK (specialty IN (
    'print',            -- imprenta offset/flexo/digital
    'large_format',     -- gran formato
    'textile',          -- serigrafía/textil
    'packaging',        -- empaques
    'finisher',         -- acabados especiales (laminado, hot-stamp)
    'mounting',         -- montaje/instalación
    'other'
  )),
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  capabilities TEXT[] DEFAULT '{}',    -- ['offset','flexo','serigrafia','digital','uv','hot-stamp']
  substrates TEXT[] DEFAULT '{}',      -- ['papel_couche','papel_offset','vinilo','cartulina','tela']
  turnaround_days INTEGER,             -- tiempo promedio de producción en días
  cost_tier TEXT DEFAULT 'standard' CHECK (cost_tier IN ('budget','standard','premium','luxury')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link designs to the supplier that produced (or will produce) them
ALTER TABLE design_file_meta ADD COLUMN IF NOT EXISTS supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_workspace ON suppliers(workspace_id, specialty);
CREATE INDEX IF NOT EXISTS idx_dfm_supplier ON design_file_meta(supplier_id);

-- ============================================================
-- 7. playbooks — plantillas de estrategia replicables
-- ============================================================
-- Un playbook es una colección de tipos de assets que responden
-- a una estrategia específica (ej. "Congreso online antes,
-- durante y después"). Se replica con el estilo de cada marca.

CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY DEFAULT ('playbook_' || substr(md5(random()::text), 1, 20)),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  playbook_type TEXT NOT NULL DEFAULT 'custom' CHECK (playbook_type IN (
    'event',            -- congreso, feria, activación
    'funnel',           -- funnel digital end-to-end
    'launch',           -- lanzamiento de producto/marca
    'retention',        -- retención de clientes
    'seasonal',         -- campaña estacional
    'cobranding',       -- co-branding
    'custom'            -- estrategia personalizada
  )),
  channel_flow JSONB DEFAULT '[]',     -- [{from:'ads', to:'landing'}, {from:'landing', to:'form'}, ...]
  asset_blueprint JSONB DEFAULT '[]',  -- [{designer_type:'digital', asset_type:'landing', qty:1}, ...]
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_workspace ON playbooks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_playbooks_brand ON playbooks(brand_id);

-- ============================================================
-- 8. RLS policies for new tables
-- ============================================================

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;

-- Drop legacy policies if any
DROP POLICY IF EXISTS "suppliers_workspace_read" ON suppliers;
DROP POLICY IF EXISTS "suppliers_workspace_write" ON suppliers;
DROP POLICY IF EXISTS "playbooks_workspace_read" ON playbooks;
DROP POLICY IF EXISTS "playbooks_workspace_write" ON playbooks;

CREATE POLICY "suppliers_workspace_read" ON suppliers FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));
CREATE POLICY "suppliers_workspace_write" ON suppliers FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

CREATE POLICY "playbooks_workspace_read" ON playbooks FOR SELECT
  USING (has_workspace_role(workspace_id, 'viewer'));
CREATE POLICY "playbooks_workspace_write" ON playbooks FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

-- ============================================================
-- 9. Grants
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON playbooks TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================================
-- 10. Backfill: migrar format → asset_type para assets legacy
-- ============================================================
-- Los archivos existentes que tenían format='social' pero
-- asset_type='other' (porque v10 no cubría todos los casos)
-- se normalizan aquí.

UPDATE design_file_meta
SET asset_type = CASE lower(coalesce(format, ''))
  WHEN 'social' THEN 'social_media'
  WHEN 'web' THEN 'web'
  WHEN 'mobile' THEN 'web'
  WHEN 'email' THEN 'mailing'
  WHEN 'print' THEN 'other'
  ELSE asset_type
END
WHERE asset_type = 'other'
  AND format IS NOT NULL
  AND format <> '';
