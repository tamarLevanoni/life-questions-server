CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION normalize_story_search_text(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $normalize$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(normalize(input, NFKC)),
          U&'[\0591-\05BD\05BF\05C1-\05C2\05C4-\05C5\05C7]', '', 'g'),
        '[''"׳״‘’“”]', '', 'g'),
      '[-־–—]', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'));
$normalize$;

CREATE TABLE IF NOT EXISTS story_search_index_versions (
  index_version TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  layout TEXT NOT NULL CHECK (layout IN ('split', 'combined', 'split-expansion')),
  recipe_version INTEGER NOT NULL CHECK (recipe_version > 0)
);

CREATE TABLE IF NOT EXISTS story_search_documents (
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  index_version TEXT NOT NULL REFERENCES story_search_index_versions(index_version) ON DELETE CASCADE ON UPDATE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scenario', 'principle', 'expansion', 'combined')),
  part INTEGER NOT NULL CHECK (part >= 0),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_model TEXT,
  embedding vector(1536),
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, normalize_story_search_text(content))
  ) STORED,
  CHECK ((embedding IS NULL) = (embedding_model IS NULL)),
  PRIMARY KEY (story_id, index_version, kind, part)
);

CREATE INDEX IF NOT EXISTS story_search_documents_version_kind_idx
  ON story_search_documents (index_version, kind);

CREATE INDEX IF NOT EXISTS story_search_documents_text_idx
  ON story_search_documents USING gin (search_vector);
