// @vitest-environment jsdom

import { StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPushToast = vi.fn();
const mockQueryClient = {
  invalidateQueries: vi.fn(),
  getQueryData: vi.fn(),
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null }),
  useQueryClient: () => mockQueryClient,
}));

vi.mock("./CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("./ToastContext", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

vi.mock("../lib/router", () => ({
  useLocation: () => ({ pathname: "/ROM/issues/ROM-594" }),
}));

import { LiveUpdatesProvider } from "./LiveUpdatesProvider";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  static reset() {
    FakeWebSocket.instances = [];
  }

  readonly url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
}

describe("LiveUpdatesProvider websocket lifecycle", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    FakeWebSocket.reset();
    mockPushToast.mockReset();
    mockQueryClient.invalidateQueries.mockReset();
    mockQueryClient.getQueryData.mockReset();
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.WebSocket = originalWebSocket;
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    vi.useRealTimers();
  });

  it("defers the initial socket open so StrictMode does not create a throwaway connecting socket", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <LiveUpdatesProvider>
            <div>child</div>
          </LiveUpdatesProvider>
        </StrictMode>,
      );
    });

    expect(FakeWebSocket.instances).toHaveLength(0);

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.url).toBe(
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/companies/company-1/events/ws`,
    );
  });
});
