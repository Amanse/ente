ALTER TYPE OBJECT_TYPE ADD VALUE 'vid_preview';
ALTER TYPE OBJECT_TYPE ADD VALUE 'img_preview';
ALTER TABLE file_data
    ADD COLUMN obj_id TEXT,
    ADD COLUMN obj_nonce TEXT,
    ADD COLUMN obj_size INTEGER;


