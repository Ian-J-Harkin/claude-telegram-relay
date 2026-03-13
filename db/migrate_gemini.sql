-- Migration script: Switch embeddings from OpenAI (1536) to Gemini (768)

-- 1. Drop the existing search functions since they depend on the old vector size
DROP FUNCTION IF EXISTS match_messages(VECTOR(1536), FLOAT, INT);
DROP FUNCTION IF EXISTS match_memory(VECTOR(1536), FLOAT, INT);

-- 2. Alter the tables to use the new vector size.
-- (This will drop existing embeddings, which is expected since they are OpenAI format)
ALTER TABLE messages ALTER COLUMN embedding TYPE VECTOR(768);
ALTER TABLE memory ALTER COLUMN embedding TYPE VECTOR(768);

-- 3. Recreate the search functions with the new vector size
CREATE OR REPLACE FUNCTION match_messages(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  role TEXT,
  created_at TIMESTAMPTZ,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.role,
    m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM messages m
  WHERE m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION match_memory(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  type TEXT,
  created_at TIMESTAMPTZ,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.type,
    m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memory m
  WHERE m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
