import { describe, expect, it } from "vitest";
import { listInviteJoinAdapterOptions } from "./invite-join-adapters";

describe("invite join adapter helpers", () => {
  it("keeps invite adapter options aligned with the UI registry", () => {
    expect(
      listInviteJoinAdapterOptions().map((option) => ({
        type: option.type,
        selectable: option.selectable,
        disabledLabel: option.disabledLabel ?? null,
      })),
    ).toEqual([
      { type: "claude_local", selectable: true, disabledLabel: null },
      { type: "codex_local", selectable: true, disabledLabel: null },
      { type: "gemini_local", selectable: true, disabledLabel: null },
      { type: "hermes_local", selectable: true, disabledLabel: null },
      { type: "opencode_local", selectable: true, disabledLabel: null },
      { type: "pi_local", selectable: true, disabledLabel: null },
      { type: "cursor", selectable: true, disabledLabel: null },
      {
        type: "openclaw_gateway",
        selectable: false,
        disabledLabel: "Use OpenClaw onboarding instructions",
      },
      { type: "process", selectable: true, disabledLabel: null },
      { type: "http", selectable: true, disabledLabel: null },
    ]);
  });
});
