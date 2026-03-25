import { ChangeEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AGENT_ADAPTER_TYPES, type MailchimpMarketingOverview } from "@paperclipai/shared";
import { useNavigate } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { agentsApi } from "../api/agents";
import { accessApi } from "../api/access";
import { assetsApi } from "../api/assets";
import { mailchimpApi } from "../api/mailchimp";
import { queryKeys } from "../lib/queryKeys";
import { parseCompanyHermesMcpServersInput } from "../lib/company-hermes-mcp";
import { Button } from "@/components/ui/button";
import { Settings, Check, Download, Upload, Bot, ArrowRight, Pause, Play } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import { StatusBadge } from "../components/StatusBadge";
import {
  Field,
  ToggleField,
  HintIcon
} from "../components/agent-config-primitives";
import { adapterLabels } from "../components/agent-config-primitives";

type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
    setLogoUrl(selectedCompany.logoUrl ?? "");
    setAgentDefaultAdapterType(selectedCompany.agentDefaultAdapterType ?? "");
    setAgentDefaultProvider(selectedCompany.agentDefaultProvider ?? "");
    setAgentDefaultModel(selectedCompany.agentDefaultModel ?? "");
    setAgentDefaultHeartbeatIntervalSec(
      selectedCompany.agentDefaultHeartbeatIntervalSec != null
        ? String(selectedCompany.agentDefaultHeartbeatIntervalSec)
        : "",
    );
    setAgentDefaultWakeOnDemand(selectedCompany.agentDefaultWakeOnDemand ?? true);
    setAgentDefaultCooldownSec(
      selectedCompany.agentDefaultCooldownSec != null
        ? String(selectedCompany.agentDefaultCooldownSec)
        : "",
    );
    setAgentDefaultMaxConcurrentRuns(
      selectedCompany.agentDefaultMaxConcurrentRuns != null
        ? String(selectedCompany.agentDefaultMaxConcurrentRuns)
        : "",
    );
    setAgentDefaultMaxTurnsPerRun(
      selectedCompany.agentDefaultMaxTurnsPerRun != null
        ? String(selectedCompany.agentDefaultMaxTurnsPerRun)
        : "",
    );
    setAgentDefaultBrowserAutomationProvider(selectedCompany.agentDefaultBrowserAutomationProvider ?? "");
    setAgentDefaultHermesManagedHome(selectedCompany.agentDefaultHermesManagedHome ?? false);
    setAgentDefaultHermesSeedCompanyProfileMemory(
      selectedCompany.agentDefaultHermesSeedCompanyProfileMemory ?? false,
    );
    setAgentDefaultHermesToolsets(selectedCompany.agentDefaultHermesToolsets ?? "");
    setAgentDefaultHermesAllowedMcpServers(selectedCompany.agentDefaultHermesAllowedMcpServers ?? "");
    setAgentDefaultHermesMcpServers(
      selectedCompany.agentDefaultHermesMcpServers
        ? JSON.stringify(selectedCompany.agentDefaultHermesMcpServers, null, 2)
        : "",
    );
    setAgentDefaultDangerouslySkipPermissions(selectedCompany.agentDefaultDangerouslySkipPermissions ?? false);
    setAgentDefaultDangerouslyBypassSandbox(selectedCompany.agentDefaultDangerouslyBypassSandbox ?? false);
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);
  const [mailchimpListId, setMailchimpListId] = useState("");
  const [mailchimpTemplateId, setMailchimpTemplateId] = useState("");
  const [mailchimpTitle, setMailchimpTitle] = useState("");
  const [mailchimpSubjectLine, setMailchimpSubjectLine] = useState("");
  const [mailchimpPreviewText, setMailchimpPreviewText] = useState("");
  const [mailchimpFromName, setMailchimpFromName] = useState("");
  const [mailchimpReplyTo, setMailchimpReplyTo] = useState("");
  const [mailchimpHtml, setMailchimpHtml] = useState("");
  const [mailchimpPlainText, setMailchimpPlainText] = useState("");
  const [agentDefaultAdapterType, setAgentDefaultAdapterType] = useState("");
  const [agentDefaultProvider, setAgentDefaultProvider] = useState("");
  const [agentDefaultModel, setAgentDefaultModel] = useState("");
  const [agentDefaultHeartbeatIntervalSec, setAgentDefaultHeartbeatIntervalSec] = useState("");
  const [agentDefaultWakeOnDemand, setAgentDefaultWakeOnDemand] = useState(true);
  const [agentDefaultCooldownSec, setAgentDefaultCooldownSec] = useState("");
  const [agentDefaultMaxConcurrentRuns, setAgentDefaultMaxConcurrentRuns] = useState("");
  const [agentDefaultMaxTurnsPerRun, setAgentDefaultMaxTurnsPerRun] = useState("");
  const [agentDefaultBrowserAutomationProvider, setAgentDefaultBrowserAutomationProvider] = useState("");
  const [agentDefaultHermesManagedHome, setAgentDefaultHermesManagedHome] = useState(false);
  const [agentDefaultHermesSeedCompanyProfileMemory, setAgentDefaultHermesSeedCompanyProfileMemory] = useState(false);
  const [agentDefaultHermesToolsets, setAgentDefaultHermesToolsets] = useState("");
  const [agentDefaultHermesAllowedMcpServers, setAgentDefaultHermesAllowedMcpServers] = useState("");
  const [agentDefaultHermesMcpServers, setAgentDefaultHermesMcpServers] = useState("");
  const [agentDefaultDangerouslySkipPermissions, setAgentDefaultDangerouslySkipPermissions] = useState(false);
  const [agentDefaultDangerouslyBypassSandbox, setAgentDefaultDangerouslyBypassSandbox] = useState(false);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const mailchimpDefaultsDirty =
    !!selectedCompany &&
    (mailchimpListId !== (selectedCompany.mailchimpDefaultListId ?? "") ||
      mailchimpTemplateId !== (selectedCompany.mailchimpDefaultTemplateId ?? "") ||
      mailchimpFromName !== (selectedCompany.mailchimpDefaultFromName ?? "") ||
      mailchimpReplyTo !== (selectedCompany.mailchimpDefaultReplyTo ?? ""));

  const agentDefaultsDirty =
    !!selectedCompany &&
    (agentDefaultAdapterType !== (selectedCompany.agentDefaultAdapterType ?? "") ||
      agentDefaultProvider !== (selectedCompany.agentDefaultProvider ?? "") ||
      agentDefaultModel !== (selectedCompany.agentDefaultModel ?? "") ||
      agentDefaultHeartbeatIntervalSec !==
        (selectedCompany.agentDefaultHeartbeatIntervalSec != null
          ? String(selectedCompany.agentDefaultHeartbeatIntervalSec)
          : "") ||
      agentDefaultWakeOnDemand !== (selectedCompany.agentDefaultWakeOnDemand ?? true) ||
      agentDefaultCooldownSec !==
        (selectedCompany.agentDefaultCooldownSec != null
          ? String(selectedCompany.agentDefaultCooldownSec)
          : "") ||
      agentDefaultMaxConcurrentRuns !==
        (selectedCompany.agentDefaultMaxConcurrentRuns != null
          ? String(selectedCompany.agentDefaultMaxConcurrentRuns)
          : "") ||
      agentDefaultMaxTurnsPerRun !==
        (selectedCompany.agentDefaultMaxTurnsPerRun != null
          ? String(selectedCompany.agentDefaultMaxTurnsPerRun)
          : "") ||
      agentDefaultBrowserAutomationProvider !== (selectedCompany.agentDefaultBrowserAutomationProvider ?? "") ||
      agentDefaultHermesManagedHome !== (selectedCompany.agentDefaultHermesManagedHome ?? false) ||
      agentDefaultHermesSeedCompanyProfileMemory !==
        (selectedCompany.agentDefaultHermesSeedCompanyProfileMemory ?? false) ||
      agentDefaultHermesToolsets !== (selectedCompany.agentDefaultHermesToolsets ?? "") ||
      agentDefaultHermesAllowedMcpServers !== (selectedCompany.agentDefaultHermesAllowedMcpServers ?? "") ||
      agentDefaultHermesMcpServers !==
        (selectedCompany.agentDefaultHermesMcpServers
          ? JSON.stringify(selectedCompany.agentDefaultHermesMcpServers, null, 2)
          : "") ||
      agentDefaultDangerouslySkipPermissions !== (selectedCompany.agentDefaultDangerouslySkipPermissions ?? false) ||
      agentDefaultDangerouslyBypassSandbox !== (selectedCompany.agentDefaultDangerouslyBypassSandbox ?? false));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const mailchimpDefaultsMutation = useMutation({
    mutationFn: () =>
      companiesApi.update(selectedCompanyId!, {
        mailchimpDefaultListId: mailchimpListId.trim() || null,
        mailchimpDefaultTemplateId: mailchimpTemplateId.trim() || null,
        mailchimpDefaultFromName: mailchimpFromName.trim() || null,
        mailchimpDefaultReplyTo: mailchimpReplyTo.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      pushToast({
        title: "Mailchimp defaults saved",
        body: "Company-level Mailchimp newsletter defaults were updated.",
      });
    },
  });

  const agentDefaultsMutation = useMutation({
    mutationFn: () => {
      const parsedHermesMcpServers = parseCompanyHermesMcpServersInput(agentDefaultHermesMcpServers);

      return companiesApi.update(selectedCompanyId!, {
        agentDefaultAdapterType: AGENT_ADAPTER_TYPES.includes(
          agentDefaultAdapterType as (typeof AGENT_ADAPTER_TYPES)[number],
        )
          ? (agentDefaultAdapterType as (typeof AGENT_ADAPTER_TYPES)[number])
          : null,
        agentDefaultProvider: agentDefaultProvider.trim() || null,
        agentDefaultModel: agentDefaultModel.trim() || null,
        agentDefaultHeartbeatIntervalSec: agentDefaultHeartbeatIntervalSec ? Number(agentDefaultHeartbeatIntervalSec) : null,
        agentDefaultWakeOnDemand: agentDefaultWakeOnDemand,
        agentDefaultCooldownSec: agentDefaultCooldownSec ? Number(agentDefaultCooldownSec) : null,
        agentDefaultMaxConcurrentRuns: agentDefaultMaxConcurrentRuns ? Number(agentDefaultMaxConcurrentRuns) : null,
        agentDefaultMaxTurnsPerRun: agentDefaultMaxTurnsPerRun ? Number(agentDefaultMaxTurnsPerRun) : null,
        agentDefaultBrowserAutomationProvider: agentDefaultBrowserAutomationProvider.trim() || null,
        agentDefaultHermesManagedHome,
        agentDefaultHermesSeedCompanyProfileMemory,
        agentDefaultHermesToolsets: agentDefaultHermesToolsets.trim() || null,
        agentDefaultHermesAllowedMcpServers: agentDefaultHermesAllowedMcpServers.trim() || null,
        agentDefaultHermesMcpServers: parsedHermesMcpServers,
        agentDefaultDangerouslySkipPermissions,
        agentDefaultDangerouslyBypassSandbox,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      pushToast({
        title: "Agent defaults saved",
        body: "New agents will inherit the updated company defaults.",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Agent defaults not saved",
        body: error instanceof Error ? error.message : "Failed to save agent defaults.",
        tone: "error",
      });
    },
  });

  const applyAgentRuntimeDefaultsMutation = useMutation({
    mutationFn: () =>
      companiesApi.applyAgentRuntimeDefaults(selectedCompanyId!, {
        provider: agentDefaultProvider.trim() || null,
        model: agentDefaultModel.trim() || null,
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId!) }),
      ]);
      pushToast({
        title: "Agent runtime defaults applied",
        body:
          `Updated ${result.affectedAgentCount} agent${result.affectedAgentCount === 1 ? "" : "s"} ` +
          `and reset ${result.resetSessionCount} saved session${result.resetSessionCount === 1 ? "" : "s"}.`,
      });
    },
    onError: (error) => {
      pushToast({
        title: "Agent runtime defaults not applied",
        body: error instanceof Error ? error.message : "Failed to apply the selected provider/model to agents.",
        tone: "error",
      });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createOpenClawInvitePrompt(selectedCompanyId!),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      let snippet: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null
        });
      } catch {
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates: null,
          testResolutionUrl: null
        });
      }
      setInviteSnippet(snippet);
      try {
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(true);
        setSnippetCopyDelightId((prev) => prev + 1);
        setTimeout(() => setSnippetCopied(false), 2000);
      } catch {
        /* clipboard may not be available */
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
      });
    },
    onError: (err) => {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invite"
      );
    }
  });

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
  }, [selectedCompanyId]);

  const mailchimpOverviewQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.mailchimp.overview(selectedCompanyId) : ["mailchimp", "disabled"],
    queryFn: () => mailchimpApi.overview(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentsQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.agents.list(selectedCompanyId) : ["agents", "disabled"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    const overview = mailchimpOverviewQuery.data;
    if (!overview) return;
    primeMailchimpForm(overview, {
      selectedCompany,
      mailchimpListId,
      setMailchimpListId,
      mailchimpTemplateId,
      setMailchimpTemplateId,
      mailchimpFromName,
      setMailchimpFromName,
      mailchimpReplyTo,
      setMailchimpReplyTo,
    });
  }, [
    mailchimpOverviewQuery.data,
    selectedCompany,
    mailchimpListId,
    mailchimpTemplateId,
    mailchimpFromName,
    mailchimpReplyTo,
  ]);

  useEffect(() => {
    setMailchimpListId("");
    setMailchimpTemplateId("");
    setMailchimpTitle("");
    setMailchimpSubjectLine("");
    setMailchimpPreviewText("");
    setMailchimpFromName("");
    setMailchimpReplyTo("");
    setMailchimpHtml("");
    setMailchimpPlainText("");
  }, [selectedCompanyId]);

  const createMailchimpCampaignMutation = useMutation({
    mutationFn: () =>
      mailchimpApi.createCampaign(selectedCompanyId!, {
        listId: mailchimpListId,
        templateId: mailchimpTemplateId.trim() || null,
        title: mailchimpTitle.trim(),
        subjectLine: mailchimpSubjectLine.trim(),
        previewText: mailchimpPreviewText.trim() || null,
        fromName: mailchimpFromName.trim(),
        replyTo: mailchimpReplyTo.trim(),
        html: mailchimpHtml,
        plainText: mailchimpPlainText.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mailchimp.overview(selectedCompanyId!),
      });
    },
  });

  const sendMailchimpCampaignMutation = useMutation({
    mutationFn: (campaignId: string) => mailchimpApi.sendCampaign(selectedCompanyId!, campaignId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mailchimp.overview(selectedCompanyId!),
      });
    },
  });

  const pauseAllMutation = useMutation({
    mutationFn: () => companiesApi.pause(selectedCompanyId!),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) }),
      ]);
      pushToast({
        title: "Company paused",
        body: `Paused ${result.affectedAgentCount} agent${result.affectedAgentCount === 1 ? "" : "s"} and blocked new work.`,
      });
    },
  });

  const resumeAllMutation = useMutation({
    mutationFn: () => companiesApi.resume(selectedCompanyId!),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.org(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) }),
      ]);
      pushToast({
        title: "Company resumed",
        body: `Resumed ${result.affectedAgentCount} paused agent${result.affectedAgentCount === 1 ? "" : "s"}.`,
      });
    },
  });
  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null
    });
  }

  const pausedAgentCount = agentsQuery.data?.filter((agent) => agent.status === "paused").length ?? 0;
  const companyPaused = selectedCompany.status === "paused";
  const canPauseAll = !companyPaused && !pauseAllMutation.isPending && selectedCompany.status !== "archived";
  const canResumeAll =
    !resumeAllMutation.isPending &&
    selectedCompany.status !== "archived" &&
    (companyPaused || pausedAgentCount > 0);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Company Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the company profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                logoUrl={logoUrl || null}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.isError || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ??
                        (logoUploadMutation.error instanceof Error
                          ? logoUploadMutation.error.message
                          : "Logo upload failed")}
                    </span>
                  )}
                  {clearLogoMutation.isError && (
                    <span className="text-xs text-destructive">
                      {clearLogoMutation.error.message}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">Uploading logo...</span>
                  )}
                </div>
              </Field>
              <Field
                label="Brand color"
                hint="Sets the hue for the company icon. Leave empty for auto-generated color."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                  ? generalMutation.error.message
                  : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Agent defaults
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Default agent runtime policy</div>
              <p className="mt-1 text-xs text-muted-foreground">
                New agents and Hermes preset creation inherit these values. Use Apply to all agents to push the selected provider/model across the company now.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyAgentRuntimeDefaultsMutation.mutate()}
                disabled={
                  applyAgentRuntimeDefaultsMutation.isPending
                  || (!agentDefaultProvider.trim() && !agentDefaultModel.trim())
                }
              >
                {applyAgentRuntimeDefaultsMutation.isPending ? "Applying..." : "Apply to all agents"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => agentDefaultsMutation.mutate()}
                disabled={!agentDefaultsDirty || agentDefaultsMutation.isPending}
              >
                {agentDefaultsMutation.isPending ? "Saving..." : "Save defaults"}
              </Button>
            </div>
          </div>
          <Field
            label="Default adapter"
            hint="Used when opening New Agent without an explicit preset. Hermes-specific presets still stay on Hermes."
          >
            <select
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={agentDefaultAdapterType}
              onChange={(e) => setAgentDefaultAdapterType(e.target.value)}
            >
              <option value="">Paperclip default</option>
              {AGENT_ADAPTER_TYPES.map((adapterType) => (
                <option key={adapterType} value={adapterType}>
                  {adapterLabels[adapterType] ?? adapterType}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Provider"
              hint="Adapter-specific provider hint. Hermes uses this to build its --provider flag."
            >
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                value={agentDefaultProvider}
                onChange={(e) => setAgentDefaultProvider(e.target.value)}
                placeholder="zai"
              />
            </Field>
            <Field label="Model" hint="Default model override for newly created agents.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                value={agentDefaultModel}
                onChange={(e) => setAgentDefaultModel(e.target.value)}
                placeholder="glm-4.7"
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Heartbeat interval (sec)" hint="Default timer interval for new agents.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                type="number"
                min={1}
                value={agentDefaultHeartbeatIntervalSec}
                onChange={(e) => setAgentDefaultHeartbeatIntervalSec(e.target.value)}
                placeholder="300"
              />
            </Field>
            <Field label="Cooldown (sec)" hint="Minimum gap between consecutive runs.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                type="number"
                min={0}
                value={agentDefaultCooldownSec}
                onChange={(e) => setAgentDefaultCooldownSec(e.target.value)}
                placeholder="10"
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Max concurrent runs" hint="Default scheduler concurrency for new agents.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                type="number"
                min={1}
                value={agentDefaultMaxConcurrentRuns}
                onChange={(e) => setAgentDefaultMaxConcurrentRuns(e.target.value)}
                placeholder="1"
              />
            </Field>
            <Field label="Max turns per run" hint="Default agentic turn limit per heartbeat run.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                type="number"
                min={1}
                value={agentDefaultMaxTurnsPerRun}
                onChange={(e) => setAgentDefaultMaxTurnsPerRun(e.target.value)}
                placeholder="300"
              />
            </Field>
          </div>
          <Field
            label="Browser automation provider"
            hint="Optional default browser runtime exposed to new process or Hermes workers."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              value={agentDefaultBrowserAutomationProvider}
              onChange={(e) => setAgentDefaultBrowserAutomationProvider(e.target.value)}
              placeholder="playwright"
            />
          </Field>
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
            <ToggleField
              label="Use Paperclip-managed Hermes home by default"
              hint="New Hermes agents get an isolated HERMES_HOME so sessions, local memory, skills, and SOUL.md stay scoped to the agent instead of the shared global install."
              checked={agentDefaultHermesManagedHome}
              onChange={setAgentDefaultHermesManagedHome}
            />
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
            <ToggleField
              label="Seed company profile into Hermes memory by default"
              hint="New Hermes agents will materialize USER.md and MEMORY.md from the Company Profile whenever they use a Paperclip-managed Hermes home."
              checked={agentDefaultHermesSeedCompanyProfileMemory}
              onChange={(checked) => {
                setAgentDefaultHermesSeedCompanyProfileMemory(checked);
                if (checked) setAgentDefaultHermesManagedHome(true);
              }}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Hermes toolsets"
              hint="Comma-separated toolsets applied to new Hermes agents, for example full,edit."
            >
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                value={agentDefaultHermesToolsets}
                onChange={(e) => setAgentDefaultHermesToolsets(e.target.value)}
                placeholder="full,edit"
              />
            </Field>
            <Field
              label="Allowed MCP servers"
              hint="Comma-separated allowlist for managed Hermes MCP servers."
            >
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                value={agentDefaultHermesAllowedMcpServers}
                onChange={(e) => setAgentDefaultHermesAllowedMcpServers(e.target.value)}
                placeholder="github,filesystem"
              />
            </Field>
          </div>
          <Field
            label="Hermes managed MCP servers (JSON)"
            hint="Optional JSON object of managed MCP server definitions inherited by new Hermes agents."
          >
            <textarea
              className="min-h-[180px] w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
              value={agentDefaultHermesMcpServers}
              onChange={(e) => setAgentDefaultHermesMcpServers(e.target.value)}
              placeholder={'{\n  "github": {\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-github"]\n  }\n}'}
              spellCheck={false}
            />
          </Field>
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-3">
            <ToggleField
              label="Wake on demand by default"
              hint="Allow assignments, UI actions, and automations to wake newly created agents."
              checked={agentDefaultWakeOnDemand}
              onChange={setAgentDefaultWakeOnDemand}
            />
            <ToggleField
              label="Skip permissions by default"
              hint="Primarily affects Claude-style local agents for unattended operation."
              checked={agentDefaultDangerouslySkipPermissions}
              onChange={setAgentDefaultDangerouslySkipPermissions}
            />
            <ToggleField
              label="Bypass sandbox by default"
              hint="Primarily affects Codex-style local agents that need unrestricted filesystem and network access."
              checked={agentDefaultDangerouslyBypassSandbox}
              onChange={setAgentDefaultDangerouslyBypassSandbox}
            />
          </div>
          {agentDefaultsMutation.isError && (
            <p className="text-xs text-destructive">
              {agentDefaultsMutation.error instanceof Error
                ? agentDefaultsMutation.error.message
                : "Failed to save agent defaults"}
            </p>
          )}
          {applyAgentRuntimeDefaultsMutation.isError && (
            <p className="text-xs text-destructive">
              {applyAgentRuntimeDefaultsMutation.error instanceof Error
                ? applyAgentRuntimeDefaultsMutation.error.message
                : "Failed to apply agent runtime defaults"}
            </p>
          )}
        </div>
      </div>

      {/* Company control */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Company control
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Pause or resume the company</div>
              <p className="text-xs text-muted-foreground">
                Pause stops the company and pauses all runnable agents. Resume clears the company pause and unpauses any paused agents.
              </p>
            </div>
            <StatusBadge status={selectedCompany.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Pause company "${selectedCompany.name}" and all runnable agents?`,
                );
                if (!confirmed) return;
                pauseAllMutation.mutate();
              }}
              disabled={!canPauseAll}
            >
              <Pause className="mr-1.5 h-3.5 w-3.5" />
              {pauseAllMutation.isPending ? "Pausing..." : "Pause All"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!selectedCompanyId) return;
                resumeAllMutation.mutate();
              }}
              disabled={!canResumeAll}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {resumeAllMutation.isPending ? "Resuming..." : "Resume All"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {pausedAgentCount} paused agent{pausedAgentCount === 1 ? "" : "s"}
            </span>
          </div>
          {pauseAllMutation.isError && (
            <p className="text-xs text-destructive">
              {pauseAllMutation.error instanceof Error ? pauseAllMutation.error.message : "Failed to pause the company"}
            </p>
          )}
          {resumeAllMutation.isError && (
            <p className="text-xs text-destructive">
              {resumeAllMutation.error instanceof Error ? resumeAllMutation.error.message : "Failed to resume the company"}
            </p>
          )}
        </div>
      </div>

      {/* Agent onboarding */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Agent onboarding
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              OpenClaw uses an invite prompt. Hermes is configured locally from the agent editor.
            </span>
            <HintIcon text="OpenClaw gets a copy-ready onboarding prompt. Hermes opens the local agent setup flow." />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Settings className="h-4 w-4 text-muted-foreground" />
                OpenClaw Gateway
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Generate a copy-ready invite prompt for a remote OpenClaw agent.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => inviteMutation.mutate()}
                  disabled={inviteMutation.isPending}
                >
                  {inviteMutation.isPending
                    ? "Generating..."
                    : "Generate Invite Prompt"}
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bot className="h-4 w-4 text-muted-foreground" />
                Hermes Agent
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a native Hermes local agent with Paperclip defaults and secret bindings prefilled.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/agents/new?adapterType=hermes_local&preset=paperclip_defaults")}
                >
                  Create Hermes Agent
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          {inviteError && (
            <p className="text-sm text-destructive">{inviteError}</p>
          )}
          {inviteSnippet && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  OpenClaw Invite Prompt
                </div>
                {snippetCopied && (
                  <span
                    key={snippetCopyDelightId}
                    className="flex items-center gap-1 text-xs text-green-600 animate-pulse"
                  >
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1.5">
                <textarea
                  className="h-[28rem] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
                  value={inviteSnippet}
                  readOnly
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteSnippet);
                        setSnippetCopied(true);
                        setSnippetCopyDelightId((prev) => prev + 1);
                        setTimeout(() => setSnippetCopied(false), 2000);
                      } catch {
                        /* clipboard may not be available */
                      }
                    }}
                  >
                    {snippetCopied ? "Copied snippet" : "Copy snippet"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mailchimp */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Mailchimp
        </div>
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">Marketing API</div>
              <p className="text-xs text-muted-foreground">
                Verify the account, inspect audiences and campaigns, create draft newsletters, and send them without browser automation.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => mailchimpOverviewQuery.refetch()}
              disabled={mailchimpOverviewQuery.isFetching}
            >
              {mailchimpOverviewQuery.isFetching ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          {mailchimpOverviewQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading Mailchimp account...</p>
          )}

          {mailchimpOverviewQuery.isError && (
            <p className="text-sm text-destructive">
              {mailchimpOverviewQuery.error instanceof Error
                ? mailchimpOverviewQuery.error.message
                : "Failed to load Mailchimp account"}
            </p>
          )}

          {mailchimpOverviewQuery.data && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <MailchimpStat
                  label="Connection"
                  value={mailchimpOverviewQuery.data.healthStatus ?? "Unknown"}
                  hint={`${mailchimpOverviewQuery.data.source === "company_secret" ? "Company secret" : "Server env"} • ${mailchimpOverviewQuery.data.datacenter}`}
                />
                <MailchimpStat
                  label="Audiences"
                  value={String(mailchimpOverviewQuery.data.totalAudiences)}
                  hint={mailchimpOverviewQuery.data.accountName ?? "Mailchimp"}
                />
                <MailchimpStat
                  label="Campaigns"
                  value={String(mailchimpOverviewQuery.data.totalCampaigns)}
                  hint={mailchimpOverviewQuery.data.pricingPlanType ?? "plan unknown"}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Audiences</div>
                  <div className="mt-2 space-y-2">
                    {mailchimpOverviewQuery.data.audiences.map((audience) => (
                      <div key={audience.id} className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">{audience.name}</div>
                          <div className="text-xs text-muted-foreground">{audience.memberCount} members</div>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {audience.fromName ?? "Unknown sender"} • {audience.fromEmail ?? "No sender email"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Existing campaigns</div>
                  <div className="mt-2 space-y-2">
                    {mailchimpOverviewQuery.data.campaigns.length === 0 && (
                      <p className="text-xs text-muted-foreground">No campaigns found.</p>
                    )}
                    {mailchimpOverviewQuery.data.campaigns.map((campaign) => (
                      <div key={campaign.id} className="rounded-md border border-border/60 bg-background px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{campaign.title || "(untitled campaign)"}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {campaign.subjectLine ?? "No subject"} • {campaign.status}
                            </div>
                          </div>
                          {campaign.status === "save" && (
                            <Button
                              size="sm"
                              onClick={() => sendMailchimpCampaignMutation.mutate(campaign.id)}
                              disabled={sendMailchimpCampaignMutation.isPending}
                            >
                              {sendMailchimpCampaignMutation.isPending &&
                              sendMailchimpCampaignMutation.variables === campaign.id
                                ? "Sending..."
                                : "Send"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {sendMailchimpCampaignMutation.isError && (
                      <p className="text-xs text-destructive">
                        {sendMailchimpCampaignMutation.error instanceof Error
                          ? sendMailchimpCampaignMutation.error.message
                          : "Failed to send campaign"}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
                <div>
                  <div className="text-sm font-medium">Create newsletter draft</div>
                  <p className="text-xs text-muted-foreground">
                    This creates a regular Mailchimp campaign draft and uploads the message content through the Marketing API.
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Default newsletter settings</div>
                      <p className="text-xs text-muted-foreground">
                        Persist the audience, template, and sender values this company should use by default.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => mailchimpDefaultsMutation.mutate()}
                      disabled={!mailchimpDefaultsDirty || mailchimpDefaultsMutation.isPending}
                    >
                      {mailchimpDefaultsMutation.isPending ? "Saving..." : "Save defaults"}
                    </Button>
                  </div>
                </div>
                <Field label="Audience" hint="The Mailchimp audience that should receive this newsletter.">
                  <select
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={mailchimpListId}
                    onChange={(e) => setMailchimpListId(e.target.value)}
                  >
                    <option value="">Select an audience</option>
                    {mailchimpOverviewQuery.data.audiences.map((audience) => (
                      <option key={audience.id} value={audience.id}>
                        {audience.name} ({audience.memberCount})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Template ID" hint="Optional Mailchimp template ID to attach when creating campaign drafts.">
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    inputMode="numeric"
                    value={mailchimpTemplateId}
                    onChange={(e) => setMailchimpTemplateId(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="10731120"
                  />
                </Field>
                <Field label="Campaign title" hint="Internal Mailchimp title for this newsletter draft.">
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={mailchimpTitle}
                    onChange={(e) => setMailchimpTitle(e.target.value)}
                  />
                </Field>
                <Field label="Subject line" hint="What subscribers see in their inbox.">
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={mailchimpSubjectLine}
                    onChange={(e) => setMailchimpSubjectLine(e.target.value)}
                  />
                </Field>
                <Field label="Preview text" hint="Optional preview snippet shown next to the subject.">
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={mailchimpPreviewText}
                    onChange={(e) => setMailchimpPreviewText(e.target.value)}
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="From name" hint="Displayed sender name.">
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                      value={mailchimpFromName}
                      onChange={(e) => setMailchimpFromName(e.target.value)}
                    />
                  </Field>
                  <Field label="Reply-to email" hint="Replies from the newsletter will go here.">
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                      type="email"
                      value={mailchimpReplyTo}
                      onChange={(e) => setMailchimpReplyTo(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="HTML body" hint="Paste the newsletter HTML that Mailchimp should send.">
                  <textarea
                    className="min-h-56 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none"
                    value={mailchimpHtml}
                    onChange={(e) => setMailchimpHtml(e.target.value)}
                  />
                </Field>
                <Field label="Plain text body" hint="Optional plain text fallback for clients that prefer text-only mail.">
                  <textarea
                    className="min-h-28 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none"
                    value={mailchimpPlainText}
                    onChange={(e) => setMailchimpPlainText(e.target.value)}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => createMailchimpCampaignMutation.mutate()}
                    disabled={
                      createMailchimpCampaignMutation.isPending ||
                      !mailchimpListId ||
                      !mailchimpTitle.trim() ||
                      !mailchimpSubjectLine.trim() ||
                      !mailchimpFromName.trim() ||
                      !mailchimpReplyTo.trim() ||
                      !mailchimpHtml.trim()
                    }
                  >
                    {createMailchimpCampaignMutation.isPending ? "Creating..." : "Create draft"}
                  </Button>
                  {createMailchimpCampaignMutation.isSuccess && (
                    <span className="text-xs text-muted-foreground">
                      Draft created: {createMailchimpCampaignMutation.data.campaign.title || createMailchimpCampaignMutation.data.campaign.id}
                    </span>
                  )}
                  {createMailchimpCampaignMutation.isError && (
                    <span className="text-xs text-destructive">
                      {createMailchimpCampaignMutation.error instanceof Error
                        ? createMailchimpCampaignMutation.error.message
                        : "Failed to create Mailchimp draft"}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Import / Export */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Company Packages
        </div>
        <div className="rounded-md border border-border px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Import and export have moved to dedicated pages accessible from the{" "}
            <a href="/org" className="underline hover:text-foreground">Org Chart</a> header.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href="/company/export">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href="/company/import">
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextCompanyId =
                  companies.find(
                    (company) =>
                      company.id !== selectedCompanyId &&
                      company.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  companyId: selectedCompanyId,
                  nextCompanyId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MailchimpStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function primeMailchimpForm(
  overview: MailchimpMarketingOverview,
  state: {
    selectedCompany: {
      mailchimpDefaultListId: string | null;
      mailchimpDefaultTemplateId: string | null;
      mailchimpDefaultFromName: string | null;
      mailchimpDefaultReplyTo: string | null;
    } | null;
    mailchimpListId: string;
    setMailchimpListId: (value: string) => void;
    mailchimpTemplateId: string;
    setMailchimpTemplateId: (value: string) => void;
    mailchimpFromName: string;
    setMailchimpFromName: (value: string) => void;
    mailchimpReplyTo: string;
    setMailchimpReplyTo: (value: string) => void;
  },
) {
  const firstAudience = overview.audiences[0] ?? null;
  if (!state.mailchimpListId) {
    if (state.selectedCompany?.mailchimpDefaultListId) {
      state.setMailchimpListId(state.selectedCompany.mailchimpDefaultListId);
    } else if (firstAudience?.id) {
      state.setMailchimpListId(firstAudience.id);
    }
  }
  if (!state.mailchimpTemplateId && state.selectedCompany?.mailchimpDefaultTemplateId) {
    state.setMailchimpTemplateId(state.selectedCompany.mailchimpDefaultTemplateId);
  }
  if (!state.mailchimpFromName) {
    if (state.selectedCompany?.mailchimpDefaultFromName) {
      state.setMailchimpFromName(state.selectedCompany.mailchimpDefaultFromName);
    } else if (firstAudience?.fromName) {
      state.setMailchimpFromName(firstAudience.fromName);
    }
  }
  if (!state.mailchimpReplyTo) {
    if (state.selectedCompany?.mailchimpDefaultReplyTo) {
      state.setMailchimpReplyTo(state.selectedCompany.mailchimpDefaultReplyTo);
    } else if (firstAudience?.fromEmail) {
      state.setMailchimpReplyTo(firstAudience.fromEmail);
    }
  }
}

function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in Paperclip, then retry.
Suggested steps:
- choose a hostname that resolves to the Paperclip host from your runtime
- run: pnpm paperclipai allowed-hostname <host>
- restart Paperclip
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in Paperclip, restart, and retry.
Suggested command:
- pnpm paperclipai allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test Paperclip-to-gateway reachability, call: ${resolutionTestUrl}?url=<urlencoded-gateway-url> (using the hostname that worked above). Do not assume your 172.x is necessarily reachable from Paperclip. Test it. `
    : "";

  return `You're invited to join a Paperclip organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than Paperclip, Paperclip must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a gateway URL that Paperclip can access. Check your config and include that URL.${resolutionLine}

---

This onboarding flow is for OpenClaw Gateway.
When you submit the join request, use:
- \`adapterType: "openclaw_gateway"\`
- \`agentDefaultsPayload.url\` as your \`ws://\` or \`wss://\` gateway URL
- \`agentDefaultsPayload.headers["x-openclaw-token"]\` with your gateway token
- (legacy accepted) \`agentDefaultsPayload.headers["x-openclaw-auth"]\`
- Keep device auth enabled (recommended). If \`devicePrivateKeyPem\` is omitted, Paperclip will generate and persist one during join so pairing approvals remain stable.
- Only use \`disableDeviceAuth=true\` for special environments where pairing cannot be completed.

Do NOT use \`/v1/responses\` or \`/hooks/*\` in this join flow.

Before you do anything, please respond to your user that you understand the instructions and you're going to work on them. Then do the step above in another session called "paperclip-onboarding" and then tell your user when you're done. Update your user in intermediate steps along the way so they know what's going on.

Then after you've connected to Paperclip (exchanged keys etc.) you MUST review and follow the onboarding instructions in onboarding.txt they give you.

`;
}

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
