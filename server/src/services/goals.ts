import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals } from "@paperclipai/db";
import { unprocessable } from "../errors.js";

type GoalReader = Pick<Db, "select">;

function isRootCompanyGoal(goal: Pick<typeof goals.$inferSelect, "level" | "parentId">) {
  return goal.level === "company" && goal.parentId == null;
}

async function countOtherRootCompanyGoals(
  db: Pick<Db, "select">,
  companyId: string,
  excludeGoalId: string,
) {
  const [row] = await db
    .select({ count: count() })
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        isNull(goals.parentId),
        ne(goals.id, excludeGoalId),
      ),
    );
  return Number(row?.count ?? 0);
}

async function assertCompanyRetainsRootGoal(
  db: Pick<Db, "select">,
  companyId: string,
  excludeGoalId: string,
) {
  const remainingRootGoals = await countOtherRootCompanyGoals(db, companyId, excludeGoalId);
  if (remainingRootGoals === 0) {
    throw unprocessable("Company must keep at least one root company goal");
  }
}

export async function getDefaultCompanyGoal(db: GoalReader, companyId: string) {
  const activeRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        eq(goals.status, "active"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (activeRootGoal) return activeRootGoal;

  const anyRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (anyRootGoal) return anyRootGoal;

  return db
    .select()
    .from(goals)
    .where(and(eq(goals.companyId, companyId), eq(goals.level, "company")))
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
}

export function goalService(db: Db) {
  return {
    list: (companyId: string) => db.select().from(goals).where(eq(goals.companyId, companyId)),

    getById: (id: string) =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null),

    getByIdForCompany: (companyId: string, id: string) =>
      db
        .select()
        .from(goals)
        .where(and(eq(goals.id, id), eq(goals.companyId, companyId)))
        .then((rows) => rows[0] ?? null),

    getDefaultCompanyGoal: (companyId: string) => getDefaultCompanyGoal(db, companyId),

    create: (companyId: string, data: Omit<typeof goals.$inferInsert, "companyId">) =>
      db
        .insert(goals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    update: async (id: string, data: Partial<typeof goals.$inferInsert>) => {
      const existing = await db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const nextLevel = data.level ?? existing.level;
      const nextParentId = data.parentId !== undefined ? data.parentId : existing.parentId;
      const remainsRootCompanyGoal = nextLevel === "company" && nextParentId == null;
      if (isRootCompanyGoal(existing) && !remainsRootCompanyGoal) {
        await assertCompanyRetainsRootGoal(db, existing.companyId, existing.id);
      }

      return db
        .update(goals)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    remove: async (id: string) => {
      const existing = await db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      if (isRootCompanyGoal(existing)) {
        await assertCompanyRetainsRootGoal(db, existing.companyId, existing.id);
      }

      return db
        .delete(goals)
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },
  };
}
