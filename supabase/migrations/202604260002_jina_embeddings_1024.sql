-- Migrate knowledge_chunks embeddings from OpenAI (1536-dim) to Jina AI (1024-dim)
--
-- IMPORTANT: This drops and recreates the embedding column.
-- All existing knowledge_chunks rows will have their embedding set to NULL.
-- You will need to re-add your knowledge documents after running this migration.
--
-- Also updates the match_knowledge_chunks and match_knowledge_chunks_by_category
-- RPC functions to accept vector(1024) query embeddings.

-- 1. Drop existing HNSW index on embedding (required before column type change)
DROP INDEX IF EXISTS public.knowledge_chunks_embedding_idx;

-- 2. Resize the embedding column to 1024 dimensions
--    pgvector does not support ALTER COLUMN TYPE directly for vector dimensions,
--    so we drop and recreate the column.
ALTER TABLE public.knowledge_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.knowledge_chunks ADD COLUMN embedding vector(1024);

-- 3. Recreate the HNSW index for the new dimension
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

-- 4. Update match_knowledge_chunks RPC to use vector(1024)
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector(1024),
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  source_name text,
  category    text,
  content     text,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    knowledge_chunks.id,
    knowledge_chunks.source_name,
    knowledge_chunks.category,
    knowledge_chunks.content,
    1 - (knowledge_chunks.embedding <=> query_embedding) as similarity
  FROM public.knowledge_chunks
  WHERE knowledge_chunks.embedding IS NOT NULL
  ORDER BY knowledge_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 5. Update match_knowledge_chunks_by_category RPC to use vector(1024)
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_by_category(
  query_embedding vector(1024),
  match_count     int DEFAULT 5,
  filter_category text DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  source_name text,
  category    text,
  content     text,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    knowledge_chunks.id,
    knowledge_chunks.source_name,
    knowledge_chunks.category,
    knowledge_chunks.content,
    1 - (knowledge_chunks.embedding <=> query_embedding) as similarity
  FROM public.knowledge_chunks
  WHERE knowledge_chunks.embedding IS NOT NULL
    AND (filter_category IS NULL OR knowledge_chunks.category = filter_category)
  ORDER BY knowledge_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
