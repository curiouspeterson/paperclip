import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  executionWorkspaces,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres execution workspace service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("execution workspace service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-execution-workspace-service-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(executionWorkspaces);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name: string) {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: name.slice(0, 3).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    return id;
  }

  async function seedProject(companyId: string, name: string) {
    const id = randomUUID();
    await db.insert(projects).values({
      id,
      companyId,
      name,
      status: "backlog",
    });
    return id;
  }

  it("does not update a workspace outside the requested company", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const foreignProjectId = await seedProject(foreignCompanyId, "Beta project");
    const workspaceId = randomUUID();
    const svc = executionWorkspaceService(db);

    await db.insert(executionWorkspaces).values({
      id: workspaceId,
      companyId: foreignCompanyId,
      projectId: foreignProjectId,
      mode: "shared_workspace",
      strategyType: "project_primary",
      name: "Foreign workspace",
      status: "active",
      providerType: "local_fs",
    });

    const updated = await svc.updateForCompany(companyId, workspaceId, {
      status: "archived",
    });

    expect(updated).toBeNull();
    expect(await svc.getById(workspaceId)).toMatchObject({
      id: workspaceId,
      companyId: foreignCompanyId,
      status: "active",
    });
  });
});
