import { createDb } from "../packages/db/src/index.js";
import { issueService } from "../server/src/services/issues.js";

type ClosableDb = ReturnType<typeof createDb> & {
  $client?: { end?: (opts?: { timeout?: number }) => Promise<void> };
};

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function closeDb(db: ClosableDb) {
  await db.$client?.end?.({ timeout: 5 }).catch(() => undefined);
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: pnpm issues:backfill-delegation-keys [--company-id <uuid>]");
    process.exit(0);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const companyId = getArgValue("--company-id");
  const db = createDb(dbUrl) as ClosableDb;

  try {
    const result = await issueService(db).backfillDelegationKeys({ companyId });
    console.log(`Updated ${result.updatedCount} legacy delegated issue keys`);
    if (result.skippedIssues.length > 0) {
      console.log(`Skipped ${result.skippedIssues.length} issues requiring manual cleanup:`);
      for (const skipped of result.skippedIssues) {
        console.log(`- ${skipped.issueId} ${skipped.reason} ${skipped.delegationKey}`);
      }
    }
  } finally {
    await closeDb(db);
  }
}

void main();
