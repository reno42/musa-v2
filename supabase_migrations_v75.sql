-- v75 · REQ-050 — imágenes como material de primer nivel en proyectos de video.
-- La pista continúa siendo `video`: image es un asset visual estático que el
-- timeline puede posicionar, transformar y exportar igual que un video.

ALTER TABLE musa_video_materials
  DROP CONSTRAINT IF EXISTS musa_video_materials_kind_check;

ALTER TABLE musa_video_materials
  ADD CONSTRAINT musa_video_materials_kind_check CHECK (kind IN (
    'video', 'image', 'audio', 'text', 'sticker', 'effect', 'transition',
    'animation', 'mask', 'canvas', 'speed', 'audio_fade'
  ));
