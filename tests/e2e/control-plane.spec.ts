import { expect, test } from "@playwright/test";
import {
  cleanupCompanyFixture,
  seedBudgetIncidentFixture,
  seedIssueTimelineFixture,
  seedPendingApprovalFixture,
} from "./support/control-plane-fixtures";

const seededCompanyIds = new Set<string>();

async function selectCompany(page: Parameters<typeof test>[0]["page"], companyId: string) {
  await page.addInitScript((selectedCompanyId: string) => {
    window.localStorage.setItem("paperclip.selectedCompanyId", selectedCompanyId);
  }, companyId);
}

function boardPath(companyPrefix: string, path: string) {
  return `/${companyPrefix}${path.startsWith("/") ? path : `/${path}`}`;
}

test.describe("Control-plane operator flows", () => {
  test.afterAll(async () => {
    for (const companyId of seededCompanyIds) {
      await cleanupCompanyFixture(companyId);
    }
    seededCompanyIds.clear();
  });

  test("renders seeded issue completion context on issue detail", async ({ page }) => {
    const fixture = await seedIssueTimelineFixture();
    seededCompanyIds.add(fixture.companyId);
    await selectCompany(page, fixture.companyId);

    await page.goto(boardPath(fixture.companyPrefix, `/issues/${fixture.issueId}`));

    await expect(page.getByRole("heading", { name: fixture.issueTitle })).toBeVisible();
    await expect(page.getByText(fixture.completionComment)).toBeVisible();
    await expect(page.getByText(`run ${fixture.runShortId}`)).toBeVisible();
    await expect(page.getByText("succeeded")).toBeVisible();
  });

  test("approves a seeded approval from the approvals inbox", async ({ page }) => {
    const fixture = await seedPendingApprovalFixture();
    seededCompanyIds.add(fixture.companyId);
    await selectCompany(page, fixture.companyId);

    await page.goto(boardPath(fixture.companyPrefix, "/approvals/pending"));

    await expect(page.getByText(fixture.label)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).first().click();

    await expect(page).toHaveURL(
      new RegExp(`/${fixture.companyPrefix}/approvals/${fixture.approvalId}(?:\\?.*)?$`),
    );
    await expect.poll(async () => {
      const response = await page.request.get(`/api/approvals/${fixture.approvalId}`);
      expect(response.ok()).toBe(true);
      const approval = await response.json();
      return approval.status;
    }).toBe("approved");
  });

  test("raises and resolves a seeded budget incident from costs", async ({ page }) => {
    const fixture = await seedBudgetIncidentFixture();
    seededCompanyIds.add(fixture.companyId);
    await selectCompany(page, fixture.companyId);

    await page.goto(boardPath(fixture.companyPrefix, "/costs"));
    await page.getByRole("tab", { name: "Budgets" }).click();

    const raiseAndResumeButton = page.getByRole("button", { name: "Raise budget & resume" });
    await expect(raiseAndResumeButton).toBeVisible();
    await raiseAndResumeButton.click();

    await expect.poll(async () => {
      const [companyResponse, overviewResponse] = await Promise.all([
        page.request.get(`/api/companies/${fixture.companyId}`),
        page.request.get(`/api/companies/${fixture.companyId}/budgets/overview`),
      ]);
      expect(companyResponse.ok()).toBe(true);
      expect(overviewResponse.ok()).toBe(true);
      const company = await companyResponse.json();
      const overview = await overviewResponse.json();
      return {
        companyStatus: company.status,
        activeIncidentCount: Array.isArray(overview.activeIncidents) ? overview.activeIncidents.length : -1,
      };
    }).toEqual({
      companyStatus: "active",
      activeIncidentCount: 0,
    });
  });
});
