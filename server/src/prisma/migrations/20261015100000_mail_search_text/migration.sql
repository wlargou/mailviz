-- Mail search reads folded text, indexed by trigram.
--
-- `search_head` folds the subject, sender and Gmail's snippet: searched by
-- substring, as before, now without regard to case or accents ("echeance"
-- finds "Échéance"). `search_body` folds the body's plain text into words,
-- each after a space, so a search matches the start of a word (" marocme"
-- finds "MarocMeteo"), the way Gmail does: a substring of a whole body would
-- find "art" in every "partner".
--
-- Both are generated here and never written by the app; `body_text` is what
-- the sync writes (`utils/mailText.ts`). The query folds what was typed with
-- the same two functions, so the two sides cannot drift apart.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- unaccent() is STABLE, because its dictionary could in principle change; a
-- generated column needs IMMUTABLE. Naming the dictionary and the schema is
-- what makes that safe to declare.
CREATE OR REPLACE FUNCTION public.mv_search_fold(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;

-- Every run of non-alphanumerics becomes one space, and one space leads, so
-- that `LIKE '% word%'` is "a word starting with word". Trimmed first: "-x"
-- typed must fold to " x", as "-x" written does.
CREATE OR REPLACE FUNCTION public.mv_search_words(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT ' ' || btrim(regexp_replace(public.mv_search_fold($1), '[^[:alnum:]]+', ' ', 'g')) $$;

-- One statement, so the table is rewritten once.
ALTER TABLE "emails"
  ADD COLUMN "body_text" TEXT,
  ADD COLUMN "search_head" TEXT GENERATED ALWAYS AS (
    public.mv_search_fold(
      coalesce("subject", '') || ' ' || coalesce("from_name", '') || ' ' || coalesce("from", '') || ' ' || coalesce("snippet", '')
    )
  ) STORED,
  ADD COLUMN "search_body" TEXT GENERATED ALWAYS AS (public.mv_search_words("body_text")) STORED;

CREATE INDEX "emails_search_head_idx" ON "emails" USING GIN ("search_head" public.gin_trgm_ops);
CREATE INDEX "emails_search_body_idx" ON "emails" USING GIN ("search_body" public.gin_trgm_ops);
