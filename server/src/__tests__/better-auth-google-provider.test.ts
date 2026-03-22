import { afterEach, describe, expect, it } from "vitest";
import { buildGoogleOAuthConfig } from "../auth/better-auth.js";

const ORIGINAL_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ORIGINAL_GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

afterEach(() => {
  if (ORIGINAL_GOOGLE_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL_GOOGLE_CLIENT_ID;

  if (ORIGINAL_GOOGLE_CLIENT_SECRET === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = ORIGINAL_GOOGLE_CLIENT_SECRET;
});

describe("buildGoogleOAuthConfig", () => {
  it("returns null when google credentials are missing", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(buildGoogleOAuthConfig()).toBeNull();
  });

  it("builds the google oauth provider config when credentials are present", () => {
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

    expect(buildGoogleOAuthConfig()).toEqual({
      providerId: "google",
      discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      scopes: ["openid", "email", "profile"],
      pkce: true,
    });
  });
});
