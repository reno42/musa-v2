-- Futuraria Design — Migration v18: fail-closed Style Library invariants
-- Apply after v17. Safe to re-run.

BEGIN;

-- One canonical implementation prevents cleanup, indexes and triggers from
-- disagreeing. Collapse whitespace first, then trim, matching cleanStyleName().
CREATE OR REPLACE FUNCTION style_clean_name(input_name TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(COALESCE(input_name, ''), '[[:space:]]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION style_canonical_name(input_name TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT lower(style_clean_name(input_name));
$$;

-- Match the service's meaningful-text rule: block comments, whitespace and
-- empty JSON containers are not artifacts or template material.
CREATE OR REPLACE FUNCTION style_meaningful_text(input_text TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  WITH cleaned AS (
    SELECT btrim(regexp_replace(
      COALESCE(input_text, ''),
      '/\*([^*]|\*+[^*/])*\*+/',
      '',
      'g'
    )) AS value
  )
  SELECT value NOT IN ('', '{}', '[]')
    AND (value ~ '[[:alnum:]#.:{$]' OR position('-' IN value) > 0)
  FROM cleaned;
$$;

-- These helpers are shared by cleanup, constraints and triggers. A template is
-- a usable style source only when it contains actual HTML/CSS/canvas material.
CREATE OR REPLACE FUNCTION style_template_has_material(template_data JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    style_meaningful_text(template_data->>'html')
    OR style_meaningful_text(template_data->>'css')
    OR CASE
      WHEN jsonb_typeof(template_data->'canvas'->'objects') = 'array'
        THEN jsonb_array_length(template_data->'canvas'->'objects') > 0
      ELSE FALSE
    END
    OR CASE
      WHEN jsonb_typeof(template_data->'canvasObjects') = 'array'
        THEN jsonb_array_length(template_data->'canvasObjects') > 0
      ELSE FALSE
    END
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(template_data->'frames') = 'array'
          THEN template_data->'frames' ELSE '[]'::jsonb END
      ) AS frame(value)
      WHERE style_meaningful_text(frame.value->>'html')
         OR style_meaningful_text(frame.value->>'css')
         OR CASE WHEN jsonb_typeof(frame.value->'objects') = 'array'
              THEN jsonb_array_length(frame.value->'objects') > 0 ELSE FALSE END
         OR CASE WHEN jsonb_typeof(frame.value->'canvasObjects') = 'array'
              THEN jsonb_array_length(frame.value->'canvasObjects') > 0 ELSE FALSE END
    );
$$;

CREATE OR REPLACE FUNCTION style_has_source_references(style_data JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(style_data->'sourceTemplateIds') = 'array'
    THEN jsonb_array_length(style_data->'sourceTemplateIds') > 0
    ELSE FALSE END;
$$;

CREATE OR REPLACE FUNCTION style_has_substantive_artifacts(style_data JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      COALESCE(style_data->>'tokensJson', ''),
      COALESCE(style_data->>'designMd', ''),
      COALESCE(style_data->>'sharedCss', '')
    ]) AS artifact(value)
    WHERE style_meaningful_text(artifact.value)
  );
$$;

-- Drop v18 enforcement temporarily so a re-run can repair partially migrated
-- data in one transaction.
DROP TRIGGER IF EXISTS trg_validate_brand_guideline ON brand_guidelines;
DROP TRIGGER IF EXISTS trg_cleanup_deleted_brand_guideline ON brand_guidelines;
DROP TRIGGER IF EXISTS trg_remove_template_style_reference ON templates;
DROP TRIGGER IF EXISTS trg_remove_soft_deleted_template_style_reference ON templates;
DROP INDEX IF EXISTS uq_brand_guidelines_workspace_normalized_name;
ALTER TABLE brand_guidelines DROP CONSTRAINT IF EXISTS brand_guidelines_name_not_blank;
ALTER TABLE brand_guidelines DROP CONSTRAINT IF EXISTS brand_guidelines_source_refs_nonempty;
ALTER TABLE brand_guidelines DROP CONSTRAINT IF EXISTS brand_guidelines_artifact_nonempty;

-- Normalize display names and filter every reference down to a real,
-- same-workspace template with usable material.
UPDATE brand_guidelines
SET name = style_clean_name(name);

UPDATE brand_guidelines AS bg
SET data = jsonb_set(
  COALESCE(bg.data, '{}'::jsonb),
  '{sourceTemplateIds}',
  COALESCE((
    SELECT jsonb_agg(valid.ref ORDER BY valid.ref)
    FROM (
      SELECT DISTINCT btrim(raw.ref) AS ref
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(bg.data->'sourceTemplateIds') = 'array'
          THEN bg.data->'sourceTemplateIds' ELSE '[]'::jsonb END
      ) AS raw(ref)
      JOIN templates AS template
        ON template.id = btrim(raw.ref)
       AND template.workspace_id = bg.workspace_id
      WHERE btrim(raw.ref) <> ''
        AND style_template_has_material(template.data)
        AND template.deleted_at IS NULL
    ) AS valid
  ), '[]'::jsonb),
  TRUE
);

-- Consolidate duplicate normalized names deterministically. Prefer the row with
-- the most references, then the latest update, then lexical ID. Artifact fields
-- missing from the winner are filled from its siblings and all refs are united.
DROP TABLE IF EXISTS pg_temp.style_v18_duplicate_map;
CREATE TEMP TABLE style_v18_duplicate_map ON COMMIT DROP AS
SELECT
  bg.id,
  first_value(bg.id) OVER (
    PARTITION BY bg.workspace_id, style_canonical_name(bg.name)
    ORDER BY
      CASE WHEN style_has_source_references(bg.data)
        THEN jsonb_array_length(bg.data->'sourceTemplateIds') ELSE 0 END DESC,
      bg.updated_at DESC,
      bg.id ASC
  ) AS canonical_id
FROM brand_guidelines AS bg
WHERE bg.workspace_id IS NOT NULL AND btrim(bg.name) <> '';

WITH merged_refs AS (
  SELECT refs.canonical_id, jsonb_agg(refs.ref ORDER BY refs.ref) AS source_refs
  FROM (
    SELECT DISTINCT duplicate_map.canonical_id, raw.ref
    FROM style_v18_duplicate_map AS duplicate_map
    JOIN brand_guidelines AS sibling ON sibling.id = duplicate_map.id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(sibling.data->'sourceTemplateIds') = 'array'
        THEN sibling.data->'sourceTemplateIds' ELSE '[]'::jsonb END
    ) AS raw(ref)
  ) AS refs
  GROUP BY refs.canonical_id
), merged_artifacts AS (
  SELECT
    duplicate_map.canonical_id,
    (array_remove(array_agg(NULLIF(btrim(sibling.data->>'tokensJson'), '')
      ORDER BY (duplicate_map.id = duplicate_map.canonical_id) DESC, sibling.updated_at DESC, sibling.id), NULL))[1] AS tokens_json,
    (array_remove(array_agg(NULLIF(btrim(sibling.data->>'designMd'), '')
      ORDER BY (duplicate_map.id = duplicate_map.canonical_id) DESC, sibling.updated_at DESC, sibling.id), NULL))[1] AS design_md,
    (array_remove(array_agg(NULLIF(btrim(sibling.data->>'sharedCss'), '')
      ORDER BY (duplicate_map.id = duplicate_map.canonical_id) DESC, sibling.updated_at DESC, sibling.id), NULL))[1] AS shared_css,
    (array_remove(array_agg(NULLIF(btrim(sibling.data->>'sourceHash'), '')
      ORDER BY (duplicate_map.id = duplicate_map.canonical_id) DESC, sibling.updated_at DESC, sibling.id), NULL))[1] AS source_hash,
    (array_remove(array_agg(NULLIF(btrim(sibling.data->>'styleFingerprint'), '')
      ORDER BY (duplicate_map.id = duplicate_map.canonical_id) DESC, sibling.updated_at DESC, sibling.id), NULL))[1] AS style_fingerprint
  FROM style_v18_duplicate_map AS duplicate_map
  JOIN brand_guidelines AS sibling ON sibling.id = duplicate_map.id
  GROUP BY duplicate_map.canonical_id
)
UPDATE brand_guidelines AS canonical
SET data = canonical.data || jsonb_strip_nulls(jsonb_build_object(
  'sourceTemplateIds', COALESCE(merged_refs.source_refs, '[]'::jsonb),
  'tokensJson', merged_artifacts.tokens_json,
  'designMd', merged_artifacts.design_md,
  'sharedCss', merged_artifacts.shared_css,
  'sourceHash', merged_artifacts.source_hash,
  'styleFingerprint', merged_artifacts.style_fingerprint
))
FROM merged_artifacts
LEFT JOIN merged_refs ON merged_refs.canonical_id = merged_artifacts.canonical_id
WHERE canonical.id = merged_artifacts.canonical_id;

UPDATE templates AS template
SET data = jsonb_set(template.data, '{brandId}', to_jsonb(duplicate_map.canonical_id), TRUE)
FROM style_v18_duplicate_map AS duplicate_map
WHERE duplicate_map.id <> duplicate_map.canonical_id
  AND template.data->>'brandId' = duplicate_map.id;

DELETE FROM brand_guidelines AS duplicate
USING style_v18_duplicate_map AS duplicate_map
WHERE duplicate.id = duplicate_map.id
  AND duplicate_map.id <> duplicate_map.canonical_id;

-- Remove rows that still cannot satisfy the invariant. Clear dangling template
-- brand pointers before deleting them.
DROP TABLE IF EXISTS pg_temp.style_v18_invalid_ids;
CREATE TEMP TABLE style_v18_invalid_ids ON COMMIT DROP AS
SELECT id
FROM brand_guidelines
WHERE workspace_id IS NULL
   OR btrim(name) = ''
   OR NOT style_has_source_references(data)
   OR NOT style_has_substantive_artifacts(data);

UPDATE templates AS template
SET data = template.data - 'brandId'
FROM style_v18_invalid_ids AS invalid
WHERE template.data->>'brandId' = invalid.id;

DELETE FROM brand_guidelines AS invalid_style
USING style_v18_invalid_ids AS invalid
WHERE invalid_style.id = invalid.id;

-- Persist canonical identity fields in data too; rowToBrand still treats the
-- dedicated columns as authoritative.
UPDATE brand_guidelines
SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
  'workspaceId', workspace_id,
  'name', name
);

ALTER TABLE brand_guidelines ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE brand_guidelines ADD CONSTRAINT brand_guidelines_name_not_blank
  CHECK (btrim(name) <> '');
ALTER TABLE brand_guidelines ADD CONSTRAINT brand_guidelines_source_refs_nonempty
  CHECK (style_has_source_references(data));
ALTER TABLE brand_guidelines ADD CONSTRAINT brand_guidelines_artifact_nonempty
  CHECK (style_has_substantive_artifacts(data));

CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_guidelines_workspace_normalized_name
  ON brand_guidelines (
    workspace_id,
    style_canonical_name(name)
  );

CREATE OR REPLACE FUNCTION validate_brand_guideline_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_refs JSONB;
  invalid_ref TEXT;
BEGIN
  NEW.workspace_id := btrim(COALESCE(NEW.workspace_id, ''));
  NEW.name := style_clean_name(NEW.name);
  IF NEW.workspace_id = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Style workspaceId must not be blank';
  END IF;
  IF NEW.name = '' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Style name must not be blank';
  END IF;

  SELECT COALESCE(jsonb_agg(refs.ref ORDER BY refs.ref), '[]'::jsonb)
  INTO normalized_refs
  FROM (
    SELECT DISTINCT btrim(raw.ref) AS ref
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(NEW.data->'sourceTemplateIds') = 'array'
        THEN NEW.data->'sourceTemplateIds' ELSE '[]'::jsonb END
    ) AS raw(ref)
    WHERE btrim(raw.ref) <> ''
  ) AS refs;

  NEW.data := COALESCE(NEW.data, '{}'::jsonb) || jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'name', NEW.name,
    'sourceTemplateIds', normalized_refs
  );

  IF NOT style_has_source_references(NEW.data) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Style requires at least one source template';
  END IF;
  IF NOT style_has_substantive_artifacts(NEW.data) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Style requires substantive tokensJson, designMd, or sharedCss';
  END IF;

  SELECT raw.ref
  INTO invalid_ref
  FROM jsonb_array_elements_text(normalized_refs) AS raw(ref)
  LEFT JOIN templates AS template ON template.id = raw.ref
  WHERE template.id IS NULL
     OR template.workspace_id <> NEW.workspace_id
     OR template.deleted_at IS NOT NULL
     OR NOT style_template_has_material(template.data)
  LIMIT 1;
  IF invalid_ref IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('Style source template %s is missing, empty, deleted, or belongs to another workspace', invalid_ref);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_brand_guideline
  BEFORE INSERT OR UPDATE ON brand_guidelines
  FOR EACH ROW EXECUTE FUNCTION validate_brand_guideline_write();

-- Deleting a style unlinks live templates but intentionally preserves their
-- designArtifacts snapshot. Remove a persisted lock only when the historical
-- workspaces.data.metadata.styleLocks object actually exists.
CREATE OR REPLACE FUNCTION cleanup_deleted_brand_guideline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE templates
  SET data = data - 'brandId'
  WHERE data->>'brandId' = OLD.id;

  UPDATE workspaces
  SET data = jsonb_set(
        data,
        '{metadata,styleLocks}',
        (data #> '{metadata,styleLocks}') - OLD.id,
        FALSE
      ),
      updated_at = NOW()
  WHERE jsonb_typeof(data #> '{metadata,styleLocks}') = 'object'
    AND (data #> '{metadata,styleLocks}') ? OLD.id;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_cleanup_deleted_brand_guideline
  AFTER DELETE ON brand_guidelines
  FOR EACH ROW EXECUTE FUNCTION cleanup_deleted_brand_guideline();

-- Removing a source template cannot leave a zero-reference guideline. Styles
-- with one source are deleted; styles with more sources have only that ref
-- removed. The same rule runs for physical and soft deletes.
CREATE OR REPLACE FUNCTION remove_template_style_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed_template_id TEXT := OLD.id;
BEGIN
  DELETE FROM brand_guidelines
  WHERE style_has_source_references(data)
    AND data->'sourceTemplateIds' ? removed_template_id
    AND jsonb_array_length(data->'sourceTemplateIds') = 1;

  UPDATE brand_guidelines AS bg
  SET data = jsonb_set(bg.data, '{sourceTemplateIds}', COALESCE((
    SELECT jsonb_agg(raw.ref ORDER BY raw.ref)
    FROM jsonb_array_elements_text(bg.data->'sourceTemplateIds') AS raw(ref)
    WHERE raw.ref <> removed_template_id
  ), '[]'::jsonb), TRUE)
  WHERE bg.data->'sourceTemplateIds' ? removed_template_id;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_remove_template_style_reference
  AFTER DELETE ON templates
  FOR EACH ROW EXECUTE FUNCTION remove_template_style_reference();

CREATE TRIGGER trg_remove_soft_deleted_template_style_reference
  AFTER UPDATE OF deleted_at ON templates
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION remove_template_style_reference();

-- Replace the historical global policies with workspace membership policies.
ALTER TABLE brand_guidelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read brand guidelines" ON brand_guidelines;
DROP POLICY IF EXISTS "Authenticated can insert brand guidelines" ON brand_guidelines;
DROP POLICY IF EXISTS "Authenticated can update brand guidelines" ON brand_guidelines;
DROP POLICY IF EXISTS "Authenticated can delete brand guidelines" ON brand_guidelines;
DROP POLICY IF EXISTS brand_guidelines_workspace_read ON brand_guidelines;
DROP POLICY IF EXISTS brand_guidelines_workspace_write ON brand_guidelines;

CREATE POLICY brand_guidelines_workspace_read ON brand_guidelines
  FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
CREATE POLICY brand_guidelines_workspace_write ON brand_guidelines
  FOR ALL
  USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

COMMIT;
