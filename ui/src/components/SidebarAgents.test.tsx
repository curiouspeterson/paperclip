// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Agent } from "@paperclipai/shared";
import { SidebarAgents } from "./SidebarAgents";

const { useMutationMock, useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
}));

function makeAgent(id: string, name: string, status: Agent["status"] = "idle"): Agent {
  const now = new Date("2026-03-21T00:00:00.000Z");
  return {
    id,
    companyId: "company-1",
    name,
    urlKey: name.toLowerCase(),
    role: "engineer",
    title: null,
    icon: null,
    status,
    reportsTo: null,
    capabilities: null,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: useMutationMock,
}));

vi.mock("@/lib/router", () => ({
  NavLink: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: "/agents/alpha" }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({ openNewAgent: vi.fn() }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false, setSidebarOpen: vi.fn() }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../hooks/useAgentOrder", () => ({
  useAgentOrder: ({ agents }: { agents: Agent[] }) => ({ orderedAgents: agents }),
}));

vi.mock("./AgentIconPicker", () => ({
  AgentIcon: () => <span data-agent-icon="true" />,
}));

vi.mock("./BudgetSidebarMarker", () => ({
  BudgetSidebarMarker: ({ title }: { title: string }) => <span title={title}>budget</span>,
}));

describe("SidebarAgents", () => {
  beforeEach(() => {
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === "agents") {
        return { data: [makeAgent("agent-1", "Alpha")] };
      }
      if (queryKey[0] === "auth") {
        return { data: { user: { id: "user-1" } } };
      }
      if (queryKey[0] === "live-runs") {
        return { data: [] };
      }
      return { data: undefined };
    });
  });

  it("renders bulk heartbeat controls and a per-agent heartbeat trigger", () => {
    const html = renderToStaticMarkup(<SidebarAgents />);

    expect(html).toContain("All Hands Heartbeat");
    expect(html).toContain("BOO!");
    expect(html).toContain("Run heartbeat");
  });
});
