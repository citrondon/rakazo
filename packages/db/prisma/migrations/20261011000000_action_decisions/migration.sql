-- CreateTable
CREATE TABLE "action_decisions" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT,
    "runId" TEXT,
    "toolName" TEXT NOT NULL,
    "connectorKind" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "enforced" BOOLEAN NOT NULL,
    "wouldDeny" BOOLEAN NOT NULL,
    "matchingRules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "action_decisions_spaceId_createdAt_idx" ON "action_decisions"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "action_decisions_runId_idx" ON "action_decisions"("runId");

-- AddForeignKey
ALTER TABLE "action_decisions" ADD CONSTRAINT "action_decisions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Decisions are a record of what was allowed. Mutating or removing one would rewrite history,
-- so the database refuses it even if a future caller gets the idea.
CREATE FUNCTION "prevent_action_decision_mutation"() RETURNS trigger
    LANGUAGE plpgsql AS
    $$
    BEGIN
        RAISE EXCEPTION 'action_decisions is append-only';
    END
    $$;

CREATE TRIGGER "action_decision_append_only"
    BEFORE UPDATE OR DELETE ON "action_decisions"
    FOR EACH ROW EXECUTE FUNCTION "prevent_action_decision_mutation"();

REVOKE UPDATE, DELETE, TRUNCATE ON "action_decisions" FROM PUBLIC;
