-- Whether a contact is a person, a shared mailbox, or a machine.
--
-- Defaults to 'person' so the column applies to an empty database and to one
-- with rows alike; existing contacts are classified by
-- `scripts/classifyContactKinds.ts`, which is a separate deliberate step because
-- it rewrites ~11.7k rows and the vocabulary is a heuristic worth reviewing
-- before it is applied.
ALTER TABLE "contacts" ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'person';

CREATE INDEX "contacts_customer_id_kind_idx" ON "contacts"("customer_id", "kind");
