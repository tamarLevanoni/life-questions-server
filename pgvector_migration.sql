-- ============================================================================
-- pgvector_migration.sql
-- ----------------------------------------------------------------------------
-- אצלך התוסף vector כבר מופעל וכל 3 העמודות (embedding, searchText,
-- embeddingModel) קיימות ב-stories. חסר רק אינדקס HNSW לחיפוש סמנטי מהיר.
-- ============================================================================
--
-- איך להחיל:
--     npx prisma migrate dev --create-only --name add_hnsw_index
--   ערכי את migration.sql שנוצר → החליפי ב-תוכן הזה → npx prisma migrate dev
-- ============================================================================

-- אינדקס HNSW על vector(1536) עם cosine distance.
-- vector_cosine_ops = למודלים מנורמלים (text-embedding-3-small/large, voyage,
-- cohere multilingual). חייב להתאים לאופרטור בשאילתה: <=> ל-cosine.
--
-- ברירות מחדל: m=16, ef_construction=64. מתאים לרוב המקרים.
-- לדאטה גדול אפשר USING hnsw (...) WITH (m = 32, ef_construction = 128).

CREATE INDEX IF NOT EXISTS "story_embedding_hnsw_idx"
ON stories
USING hnsw ("embedding" vector_cosine_ops);

-- אינדקס משני על embeddingModel — מאיץ "מצא סיפורים שלא במודל הנוכחי"
CREATE INDEX IF NOT EXISTS "story_embedding_model_idx"
ON stories ("embeddingModel");

-- ============================================================================
-- שאילתת חיפוש סמנטי לדוגמה:
--
--   SELECT id, "title", "summaryAi",
--          embedding <=> $1::vector AS distance
--   FROM stories
--   WHERE embedding IS NOT NULL
--   ORDER BY embedding <=> $1::vector
--   LIMIT 5;
--
-- ב-Prisma TypeScript:
--   const results = await prisma.$queryRawUnsafe(
--     `SELECT id, title, "summaryAi"
--      FROM stories
--      ORDER BY embedding <=> $1::vector
--      LIMIT 5`,
--     `[${queryVector.join(',')}]`
--   );
-- ============================================================================
