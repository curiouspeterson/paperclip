import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { podcastWorkflows } from "@paperclipai/db";

export function podcastWorkflowService(db: Db) {
  return {
    list: (companyId: string) =>
      db.select().from(podcastWorkflows).where(eq(podcastWorkflows.companyId, companyId)),

    getById: (id: string) =>
      db
        .select()
        .from(podcastWorkflows)
        .where(eq(podcastWorkflows.id, id))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof podcastWorkflows.$inferInsert, "companyId">) =>
      db
        .insert(podcastWorkflows)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    update: (id: string, data: Partial<typeof podcastWorkflows.$inferInsert>) =>
      db
        .update(podcastWorkflows)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(podcastWorkflows.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
