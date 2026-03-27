import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  goals,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companyService } from "../services/companies.js";
import { goalService } from "../services/goals.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company goal contract tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("company goal contracts", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-goal-contract-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(goals);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("creates a root company goal automatically for every new company", async () => {
    const company = await companyService(db).create({
      name: "Alpha Labs",
      description: "Build a sustainable AI product business.",
      budgetMonthlyCents: 0,
    });

    const companyGoals = await db
      .select()
      .from(goals)
      .where(eq(goals.companyId, company.id));

    expect(companyGoals).toHaveLength(1);
    expect(companyGoals[0]).toMatchObject({
      companyId: company.id,
      title: "Alpha Labs",
      description: "Build a sustainable AI product business.",
      level: "company",
      status: "planned",
      parentId: null,
    });
  });

  it("rejects deleting the last root company goal", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Alpha",
      issuePrefix: "ALP",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Alpha mission",
      level: "company",
      status: "active",
      parentId: null,
    });

    await expect(goalService(db).remove(goalId)).rejects.toMatchObject({
      status: 422,
      message: "Company must keep at least one root company goal",
    });
  });

  it("rejects demoting the last root company goal into a child goal", async () => {
    const companyId = randomUUID();
    const rootGoalId = randomUUID();
    const childParentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Alpha",
      issuePrefix: "ALP",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values([
      {
        id: rootGoalId,
        companyId,
        title: "Alpha mission",
        level: "company",
        status: "active",
        parentId: null,
      },
      {
        id: childParentId,
        companyId,
        title: "Existing parent",
        level: "team",
        status: "active",
        parentId: null,
      },
    ]);

    await expect(goalService(db).update(rootGoalId, { parentId: childParentId })).rejects.toMatchObject({
      status: 422,
      message: "Company must keep at least one root company goal",
    });
  });
});
