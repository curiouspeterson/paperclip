type MaybeId = string | null | undefined;

export function resolveIssueGoalId(input: {
  projectId: MaybeId;
  goalId: MaybeId;
  projectGoalId?: MaybeId;
  parentGoalId?: MaybeId;
  defaultGoalId: MaybeId;
}): string | null {
  if (input.goalId) return input.goalId;
  if (input.projectId) return input.projectGoalId ?? null;
  if (input.parentGoalId) return input.parentGoalId;
  return input.defaultGoalId ?? null;
}

export function resolveNextIssueGoalId(input: {
  currentProjectId: MaybeId;
  currentGoalId: MaybeId;
  currentProjectGoalId?: MaybeId;
  currentParentGoalId?: MaybeId;
  projectId?: MaybeId;
  goalId?: MaybeId;
  projectGoalId?: MaybeId;
  parentId?: MaybeId;
  parentGoalId?: MaybeId;
  defaultGoalId: MaybeId;
}): string | null {
  const projectId =
    input.projectId !== undefined ? input.projectId : input.currentProjectId;
  const projectGoalId =
    input.projectGoalId !== undefined
      ? input.projectGoalId
      : projectId
        ? input.currentProjectGoalId
        : null;
  const parentId =
    input.parentId !== undefined ? input.parentId : undefined;
  const parentGoalId =
    input.parentGoalId !== undefined
      ? input.parentGoalId
      : parentId !== undefined
        ? input.currentParentGoalId
        : input.currentParentGoalId;

  const resolveFallbackGoalId = (
    targetProjectId: MaybeId,
    targetProjectGoalId: MaybeId,
    targetParentGoalId: MaybeId,
  ) => {
    if (targetProjectId) return targetProjectGoalId ?? null;
    if (targetParentGoalId) return targetParentGoalId ?? null;
    return input.defaultGoalId ?? null;
  };

  if (input.goalId !== undefined) {
    return input.goalId ?? resolveFallbackGoalId(projectId, projectGoalId, parentGoalId);
  }

  const currentFallbackGoalId = resolveFallbackGoalId(
    input.currentProjectId,
    input.currentProjectGoalId,
    input.currentParentGoalId,
  );
  const nextFallbackGoalId = resolveFallbackGoalId(projectId, projectGoalId, parentGoalId);

  if (!input.currentGoalId) {
    return nextFallbackGoalId;
  }

  if (input.currentGoalId === currentFallbackGoalId) {
    return nextFallbackGoalId;
  }

  return input.currentGoalId;
}
