type HermesContextProfile = {
  companyName?: string | null;
  voiceDescription?: string | null;
  targetAudience?: string | null;
  defaultChannel?: string | null;
  defaultGoal?: string | null;
  voiceExamplesRight?: string[] | null;
  voiceExamplesWrong?: string[] | null;
};

type HermesAgentContextDefaults = {
  agentDefaultHermesManagedHome?: boolean | null;
  agentDefaultHermesSeedCompanyProfileMemory?: boolean | null;
};

export type HermesContextPreviewDoc = {
  key: "SOUL.md" | "AGENTS.md" | "USER.md" | "MEMORY.md";
  title: string;
  description: string;
  content: string;
};

export type HermesEffectiveContextPreview = {
  managedHome: boolean;
  companyProfileMemorySeeded: boolean;
  policySources: {
    managedHome: "agent_override" | "company_default";
    companyProfileMemorySeeded: "agent_override" | "company_default";
  };
  docs: HermesContextPreviewDoc[];
};

export type HermesEffectiveContextDiffEntry = {
  key: "managedHome" | "memorySeeding";
  label: string;
  detail: string;
  affectedDocs: HermesContextPreviewDoc["key"][];
};

export type HermesEffectiveContextDiff = {
  matchesCompanyDefaults: boolean;
  entries: HermesEffectiveContextDiffEntry[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function buildHermesContextPreviewState(dirty: boolean) {
  return dirty
    ? {
      label: "Previewing unsaved edits",
      description: "The generated Hermes files below reflect the form changes on this page, not just the last saved company profile.",
    }
    : {
      label: "Using saved company profile",
      description: "The generated Hermes files below match the last saved company profile and current Hermes policy defaults.",
    };
}

export function buildHermesContextBundleText(docs: HermesContextPreviewDoc[]) {
  return docs
    .map((doc) => `${doc.title}\n${"=".repeat(doc.title.length)}\n\n${doc.content}`)
    .join("\n\n");
}

export function buildHermesContextArchiveFiles(docs: HermesContextPreviewDoc[]) {
  return Object.fromEntries(
    docs.map((doc) => [doc.key, doc.content]),
  ) as Record<string, string>;
}

export function buildEffectiveHermesContextPreview(input: {
  profile: HermesContextProfile;
  agentConfig?: unknown;
  companyDefaults?: HermesAgentContextDefaults | null;
}): HermesEffectiveContextPreview {
  const agentConfig = asRecord(input.agentConfig);
  const managedHome =
    typeof agentConfig?.paperclipManagedHermesHome === "boolean"
      ? agentConfig.paperclipManagedHermesHome
      : (input.companyDefaults?.agentDefaultHermesManagedHome ?? false);
  const companyProfileMemorySeeded =
    typeof agentConfig?.paperclipSeedCompanyProfileMemory === "boolean"
      ? agentConfig.paperclipSeedCompanyProfileMemory
      : (input.companyDefaults?.agentDefaultHermesSeedCompanyProfileMemory ?? false);

  return {
    managedHome,
    companyProfileMemorySeeded,
    policySources: {
      managedHome: typeof agentConfig?.paperclipManagedHermesHome === "boolean" ? "agent_override" : "company_default",
      companyProfileMemorySeeded:
        typeof agentConfig?.paperclipSeedCompanyProfileMemory === "boolean" ? "agent_override" : "company_default",
    },
    docs: managedHome
      ? buildHermesContextPreview(input.profile, { includeMemoryDocs: companyProfileMemorySeeded })
      : [],
  };
}

export function buildHermesEffectiveContextDiff(input: {
  profile: HermesContextProfile;
  agentConfig?: unknown;
  companyDefaults?: HermesAgentContextDefaults | null;
}): HermesEffectiveContextDiff {
  const companyManagedHome = input.companyDefaults?.agentDefaultHermesManagedHome ?? false;
  const companyProfileMemorySeeded =
    input.companyDefaults?.agentDefaultHermesSeedCompanyProfileMemory ?? false;
  const effectivePreview = buildEffectiveHermesContextPreview(input);
  const companyDocs = buildHermesContextPreview(input.profile, {
    includeMemoryDocs: companyProfileMemorySeeded,
  });

  const entries: HermesEffectiveContextDiffEntry[] = [];

  if (effectivePreview.managedHome !== companyManagedHome) {
    entries.push({
      key: "managedHome",
      label: "Managed Hermes home",
      detail: effectivePreview.managedHome
        ? "This agent opts into a Paperclip-managed Hermes home instead of the company default external/shared home."
        : "This agent opts out of the company default Paperclip-managed Hermes home, so Paperclip will not materialize company context files for it.",
      affectedDocs: (effectivePreview.managedHome ? effectivePreview.docs : companyDocs).map((doc) => doc.key),
    });
  }

  if (effectivePreview.companyProfileMemorySeeded !== companyProfileMemorySeeded) {
    entries.push({
      key: "memorySeeding",
      label: "Company profile memory seeding",
      detail: effectivePreview.companyProfileMemorySeeded
        ? "This agent adds Hermes memory files from the company profile even though that is not the company default."
        : "This agent suppresses the company default Hermes memory files seeded from the company profile.",
      affectedDocs: ["USER.md", "MEMORY.md"],
    });
  }

  return {
    matchesCompanyDefaults: entries.length === 0,
    entries,
  };
}

function asString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function asStringArray(values: string[] | null | undefined) {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeProfile(profile: HermesContextProfile) {
  return {
    companyName: asString(profile.companyName),
    voiceDescription: asString(profile.voiceDescription),
    targetAudience: asString(profile.targetAudience),
    defaultChannel: asString(profile.defaultChannel),
    defaultGoal: asString(profile.defaultGoal),
    voiceExamplesRight: asStringArray(profile.voiceExamplesRight),
    voiceExamplesWrong: asStringArray(profile.voiceExamplesWrong),
  };
}

function hasMeaningfulProfile(profile: ReturnType<typeof normalizeProfile>) {
  return !!(
    profile.companyName
    || profile.voiceDescription
    || profile.targetAudience
    || profile.defaultChannel
    || profile.defaultGoal
    || profile.voiceExamplesRight.length > 0
    || profile.voiceExamplesWrong.length > 0
  );
}

function buildSoulMd(profile: ReturnType<typeof normalizeProfile>) {
  const lines = [
    "# SOUL.md -- Company Voice",
    "",
    "Use this as the default brand-voice reference for work done on behalf of the company.",
  ];
  if (profile.companyName) lines.push("", `Company: ${profile.companyName}`);
  if (profile.voiceDescription) lines.push("", "## How We Describe Our Voice", "", profile.voiceDescription);
  if (profile.targetAudience) lines.push("", "## Who We Are Talking To", "", profile.targetAudience);
  if (profile.defaultChannel) lines.push("", "## Default Channel", "", profile.defaultChannel);
  if (profile.defaultGoal) lines.push("", "## Default Goal", "", profile.defaultGoal);
  if (profile.voiceExamplesRight.length > 0) {
    lines.push("", "## Examples That Feel Exactly Right", "");
    profile.voiceExamplesRight.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  if (profile.voiceExamplesWrong.length > 0) {
    lines.push("", "## Examples That Feel Wrong", "");
    profile.voiceExamplesWrong.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  return lines.join("\n");
}

function buildAgentsMd(profile: ReturnType<typeof normalizeProfile>) {
  const lines = [
    "# AGENTS.md -- Company Prompt Packet",
    "",
    "Before writing, planning, or editing for this company, anchor on this packet:",
    "",
    "1. Here is how we describe our voice.",
    "2. Here are examples that feel exactly right.",
    "3. Here are examples that feel wrong.",
    "4. Here is who we are talking to.",
    "5. Here is what the piece needs to achieve.",
  ];
  if (profile.voiceDescription) lines.push("", "## Voice", "", profile.voiceDescription);
  if (profile.voiceExamplesRight.length > 0) {
    lines.push("", "## Right Examples", "");
    profile.voiceExamplesRight.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  if (profile.voiceExamplesWrong.length > 0) {
    lines.push("", "## Wrong Examples", "");
    profile.voiceExamplesWrong.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  if (profile.targetAudience) lines.push("", "## Audience", "", profile.targetAudience);
  if (profile.defaultChannel) lines.push("", "## Channel", "", profile.defaultChannel);
  if (profile.defaultGoal) lines.push("", "## Goal", "", profile.defaultGoal);
  return lines.join("\n");
}

function buildUserMd(profile: ReturnType<typeof normalizeProfile>) {
  const lines = [
    "# USER.md -- Working Audience",
    "",
    "Treat this as stable user/company context for this Hermes home.",
  ];
  if (profile.companyName) lines.push("", `Company: ${profile.companyName}`);
  if (profile.targetAudience) lines.push("", "## Audience", "", profile.targetAudience);
  if (profile.defaultChannel) lines.push("", "## Default Channel", "", profile.defaultChannel);
  if (profile.defaultGoal) lines.push("", "## Default Goal", "", profile.defaultGoal);
  return lines.join("\n");
}

function buildMemoryMd(profile: ReturnType<typeof normalizeProfile>) {
  const lines = [
    "# MEMORY.md -- Seeded Company Memory",
    "",
    "Seeded from the Paperclip Company Profile. Treat these as durable brand facts unless the profile changes.",
  ];
  if (profile.voiceDescription) lines.push("", "## Voice", "", profile.voiceDescription);
  if (profile.targetAudience) lines.push("", "## Audience", "", profile.targetAudience);
  if (profile.defaultChannel) lines.push("", "## Channel", "", profile.defaultChannel);
  if (profile.defaultGoal) lines.push("", "## Goal", "", profile.defaultGoal);
  if (profile.voiceExamplesRight.length > 0) {
    lines.push("", "## Right Examples", "");
    profile.voiceExamplesRight.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  if (profile.voiceExamplesWrong.length > 0) {
    lines.push("", "## Wrong Examples", "");
    profile.voiceExamplesWrong.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  return lines.join("\n");
}

export function buildHermesContextPreview(
  profileInput: HermesContextProfile,
  options?: { includeMemoryDocs?: boolean },
): HermesContextPreviewDoc[] {
  const profile = normalizeProfile(profileInput);
  if (!hasMeaningfulProfile(profile)) return [];

  const docs: HermesContextPreviewDoc[] = [
    {
      key: "SOUL.md",
      title: "SOUL.md",
      description: "Voice anchor Hermes reads as the default brand personality for the company.",
      content: buildSoulMd(profile),
    },
    {
      key: "AGENTS.md",
      title: "AGENTS.md",
      description: "Prompt-packet framing Hermes uses before writing, planning, or editing.",
      content: buildAgentsMd(profile),
    },
  ];

  if (options?.includeMemoryDocs) {
    docs.push(
      {
        key: "USER.md",
        title: "USER.md",
        description: "Stable audience and channel context for the managed Hermes home.",
        content: buildUserMd(profile),
      },
      {
        key: "MEMORY.md",
        title: "MEMORY.md",
        description: "Seeded durable brand facts Hermes can treat as reusable company memory.",
        content: buildMemoryMd(profile),
      },
    );
  }

  return docs;
}
