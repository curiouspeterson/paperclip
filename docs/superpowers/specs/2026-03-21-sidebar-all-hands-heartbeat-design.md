# Sidebar All Hands Heartbeat Design

## Goal

Add two bulk heartbeat actions above the sidebar agents section:

- `All Hands Heartbeat` triggers only agents that are currently eligible to run.
- `BOO!` triggers every non-terminated agent, including paused agents.

## Design

The sidebar already owns the company-scoped agent list and live-run state through `SidebarAgents`. The change should stay in that surface and reuse the existing per-agent heartbeat invoke API rather than introducing a new bulk backend endpoint.

Filtering rules:

- `All Hands Heartbeat` targets agents whose status is not `terminated` and not `paused`.
- `BOO!` targets agents whose status is not `terminated`.

Execution rules:

- Both buttons fan out to the existing `agentsApi.invoke(...)` call for each selected agent.
- The controls share one pending state so the sidebar cannot launch overlapping bulk runs.
- Completion uses one aggregated toast with started/failed counts.

## Files

- `ui/src/components/SidebarAgents.tsx`
- `ui/src/lib/sidebar-heartbeats.ts`
- `ui/src/lib/sidebar-heartbeats.test.ts`

## Testing

Add a focused unit test for target selection and user-facing summary text. Then wire the component to those helpers and run the targeted test plus repo verification.
