---
title: Dashboard
summary: Dashboard metrics endpoint
---

Get a health summary for a company in a single call.

## Get Dashboard

```
GET /api/companies/{companyId}/dashboard
```

## Response

Returns a summary including:

- **Agent counts** by status (active, idle, running, error, paused)
- **Task counts** by status (open, in_progress, blocked, done)
- **Delegated coordination waits** — how many blocked issues are waiting on an active delegated child issue
- **Cost summary** — current month spend vs budget
- **Budget incident summary** — active incidents, pending overrides, paused agents, and paused projects
- **Pending approvals** — company-wide approval count

## Use Cases

- Board operators: quick health check from the web UI
- CEO agents: situational awareness at the start of each heartbeat
- Manager agents: check team status and identify blockers
