-- Alternate addresses for a contact, populated only by contact merges.
--
-- Contacts are joined to mail by the email *string* (`emails.from = contacts.email`);
-- there is no foreign key from emails to contacts. Merging contact B into
-- contact A therefore silently drops every message B's address ever sent unless
-- that address is preserved. This table preserves it.
--
-- Additive and empty-database safe: a new table plus its indexes, no backfill,
-- no changes to existing columns.
CREATE TABLE "contact_email_aliases" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "merged_from_contact_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_email_aliases_pkey" PRIMARY KEY ("id")
);

-- One row per (contact, address): re-merging the same pair is a no-op rather
-- than a duplicate.
CREATE UNIQUE INDEX "contact_email_aliases_contact_id_email_key" ON "contact_email_aliases"("contact_id", "email");

-- Looking up "which contact owns this address" is how mail is attributed.
CREATE INDEX "contact_email_aliases_email_idx" ON "contact_email_aliases"("email");

ALTER TABLE "contact_email_aliases"
    ADD CONSTRAINT "contact_email_aliases_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
