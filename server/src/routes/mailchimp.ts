import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createMailchimpCampaignSchema,
  sendMailchimpCampaignSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity, mailchimpService } from "../services/index.js";

export function mailchimpRoutes(db: Db) {
  const router = Router();
  const svc = mailchimpService(db);

  router.get("/companies/:companyId/integrations/mailchimp/marketing", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.getOverview(companyId);
    res.json(result);
  });

  router.post(
    "/companies/:companyId/integrations/mailchimp/marketing/campaigns",
    validate(createMailchimpCampaignSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await svc.createCampaign(companyId, req.body);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "mailchimp.campaign.created",
        entityType: "company",
        entityId: companyId,
        details: {
          campaignId: result.campaign.id,
          title: result.campaign.title,
          listId: result.campaign.listId,
        },
      });

      res.status(201).json(result);
    },
  );

  router.post(
    "/companies/:companyId/integrations/mailchimp/marketing/campaigns/:campaignId/send",
    validate(sendMailchimpCampaignSchema.omit({ campaignId: true })),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const campaignId = req.params.campaignId as string;
      assertCompanyAccess(req, companyId);
      const result = await svc.sendCampaign(companyId, campaignId);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "mailchimp.campaign.sent",
        entityType: "company",
        entityId: companyId,
        details: {
          campaignId,
        },
      });

      res.json(result);
    },
  );

  return router;
}
