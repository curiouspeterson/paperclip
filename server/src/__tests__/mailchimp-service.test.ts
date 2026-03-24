import { afterEach, describe, expect, it, vi } from "vitest";
import { mailchimpService } from "../services/mailchimp.js";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function createEmptyDb() {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  };
}

describe("mailchimpService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MAILCHIMP_API_KEY;
  });

  it("loads account overview from the Mailchimp Marketing API using env fallback", async () => {
    process.env.MAILCHIMP_API_KEY = "testkey-us19";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ health_status: "Everything's Chimpy!" }))
      .mockResolvedValueOnce(
        jsonResponse({
          account_name: "Romance Unzipped",
          username: "romanceunzipped@gmail.com",
          email: "romanceunzipped@gmail.com",
          role: "owner",
          pricing_plan_type: "forever_free",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total_items: 1,
          lists: [
            {
              id: "e37373151b",
              name: "Writer",
              permission_reminder: "You opted in on the website.",
              campaign_defaults: {
                from_name: "Annie",
                from_email: "romanceunzipped@gmail.com",
              },
              stats: {
                member_count: 203,
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total_items: 1,
          campaigns: [
            {
              id: "c54ee44f11",
              status: "save",
              emails_sent: 0,
              send_time: null,
              settings: {
                title: "Welcome Newsletter",
                subject_line: "Welcome to Romance Unzipped",
                preview_text: "Fresh romance recs",
                from_name: "Annie",
                reply_to: "romanceunzipped@gmail.com",
              },
              recipients: {
                list_id: "e37373151b",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const svc = mailchimpService(createEmptyDb() as never);
    const overview = await svc.getOverview("company-1");

    expect(overview.source).toBe("process_env");
    expect(overview.datacenter).toBe("us19");
    expect(overview.totalAudiences).toBe(1);
    expect(overview.audiences[0]).toMatchObject({
      id: "e37373151b",
      name: "Writer",
      memberCount: 203,
      fromEmail: "romanceunzipped@gmail.com",
    });
    expect(overview.campaigns[0]).toMatchObject({
      id: "c54ee44f11",
      title: "Welcome Newsletter",
      listId: "e37373151b",
    });
  });

  it("creates a draft campaign and uploads content", async () => {
    process.env.MAILCHIMP_API_KEY = "testkey-us19";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "new-campaign" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "new-campaign",
          status: "save",
          emails_sent: 0,
          send_time: null,
          settings: {
            title: "Episode Drop",
            subject_line: "New episode live",
            preview_text: "This week on Romance Unzipped",
            from_name: "Annie",
            reply_to: "romanceunzipped@gmail.com",
          },
          recipients: {
            list_id: "e37373151b",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const svc = mailchimpService(createEmptyDb() as never);
    const result = await svc.createCampaign("company-1", {
      listId: "e37373151b",
      templateId: "10731120",
      title: "Episode Drop",
      subjectLine: "New episode live",
      previewText: "This week on Romance Unzipped",
      fromName: "Annie",
      replyTo: "romanceunzipped@gmail.com",
      html: "<h1>Hello</h1>",
      plainText: "Hello",
    });

    expect(result.ok).toBe(true);
    expect(result.campaign).toMatchObject({
      id: "new-campaign",
      title: "Episode Drop",
      status: "save",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      settings: {
        template_id: 10731120,
      },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/campaigns/new-campaign/content");
  });
});
