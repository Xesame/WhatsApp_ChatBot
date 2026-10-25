-- Postgres extensions the schema depends on. This runs before any table is
-- created, because later migrations build indexes that need them.
-- pg_trgm: trigram similarity, used for fuzzy Arabic/English name matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
