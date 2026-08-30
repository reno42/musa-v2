-- v38 — Repair deck font imports written by deck-generator.mjs.
--
-- The generator hardcoded `:ital,wght@0,300..800;1,300..800` onto every
-- family. Google css2 answers HTTP 400 for families that lack those axes
-- (Space Grotesk: no italic, wght 300–700), so the stylesheet never loaded
-- and decks collapsed to their serif fallback on every reload. Stripping the
-- axis leaves the bare `family=<Name>` form, which css2 always serves with
-- the family's own default/range.
--
-- Idempotent: rows without the signature no longer match the WHERE clause.

UPDATE templates
SET data = jsonb_set(
  data,
  '{frames}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN f->>'css' LIKE '%:ital,wght@0,300..800;1,300..800%'
          THEN jsonb_set(f, '{css}', to_jsonb(replace(f->>'css', ':ital,wght@0,300..800;1,300..800', '')))
        ELSE f
      END ORDER BY ord
    )
    FROM jsonb_array_elements(data->'frames') WITH ORDINALITY AS el(f, ord)
  )
)
WHERE data->'frames' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(data->'frames') f
    WHERE f->>'css' LIKE '%:ital,wght@0,300..800;1,300..800%'
  );
