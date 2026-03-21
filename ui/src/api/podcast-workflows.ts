import type { WorkspaceOperation } from "@paperclipai/shared";
import type { PodcastWorkflow } from "@paperclipai/shared";
import { api } from "./client";

export const podcastWorkflowsApi = {
  list: (companyId: string) =>
    api.get<PodcastWorkflow[]>(`/companies/${companyId}/podcast-workflows`),
  get: (id: string) => api.get<PodcastWorkflow>(`/podcast-workflows/${id}`),
  operations: (id: string) =>
    api.get<WorkspaceOperation[]>(`/podcast-workflows/${id}/operations`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<PodcastWorkflow>(`/companies/${companyId}/podcast-workflows`, data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<PodcastWorkflow>(`/podcast-workflows/${id}`, data),
  run: (id: string, data: Record<string, unknown>) =>
    api.post<{ workflow: PodcastWorkflow; operation: WorkspaceOperation }>(
      `/podcast-workflows/${id}/run`,
      data,
    ),
};
