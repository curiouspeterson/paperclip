import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookText, MessageSquareQuote, Target, Users, Megaphone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { queryKeys } from "../lib/queryKeys";
import { Field } from "../components/agent-config-primitives";

function normalizeSamples(values: string[]) {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function SampleListEditor({
  label,
  helper,
  values,
  onChange,
  emptyLabel,
  maxItems,
}: {
  label: string;
  helper: string;
  values: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
  maxItems: number;
}) {
  const rows = values.length > 0 ? values : [""];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{helper}</p>
        </div>
        <div className="text-xs text-muted-foreground">{normalizeSamples(values).length}/{maxItems}</div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows.map((value, index) => (
          <div key={index} className="rounded-lg border border-border/70 bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {label} {index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                disabled={rows.length === 1 && value.trim().length === 0}
                onClick={() => {
                  const next = rows.filter((_, rowIndex) => rowIndex !== index);
                  onChange(next.length > 0 ? next : []);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <textarea
              className="min-h-[112px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-0 placeholder:text-muted-foreground/60"
              placeholder={emptyLabel}
              value={value}
              onChange={(event) => {
                const next = [...rows];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= maxItems}
          onClick={() => onChange([...rows, ""])}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add sample
        </Button>
      </div>
    </div>
  );
}

export function CompanyProfile() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [voiceDescription, setVoiceDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [defaultChannel, setDefaultChannel] = useState("");
  const [defaultGoal, setDefaultGoal] = useState("");
  const [voiceExamplesRight, setVoiceExamplesRight] = useState<string[]>([]);
  const [voiceExamplesWrong, setVoiceExamplesWrong] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedCompany) return;
    setVoiceDescription(selectedCompany.voiceDescription ?? "");
    setTargetAudience(selectedCompany.targetAudience ?? "");
    setDefaultChannel(selectedCompany.defaultChannel ?? "");
    setDefaultGoal(selectedCompany.defaultGoal ?? "");
    setVoiceExamplesRight(selectedCompany.voiceExamplesRight ?? []);
    setVoiceExamplesWrong(selectedCompany.voiceExamplesWrong ?? []);
  }, [selectedCompany]);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Profile" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const normalizedRight = useMemo(() => normalizeSamples(voiceExamplesRight), [voiceExamplesRight]);
  const normalizedWrong = useMemo(() => normalizeSamples(voiceExamplesWrong), [voiceExamplesWrong]);

  const dirty = !!selectedCompany && (
    voiceDescription !== (selectedCompany.voiceDescription ?? "")
    || targetAudience !== (selectedCompany.targetAudience ?? "")
    || defaultChannel !== (selectedCompany.defaultChannel ?? "")
    || defaultGoal !== (selectedCompany.defaultGoal ?? "")
    || !arraysEqual(normalizedRight, selectedCompany.voiceExamplesRight ?? [])
    || !arraysEqual(normalizedWrong, selectedCompany.voiceExamplesWrong ?? [])
  );

  const profileMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, {
      voiceDescription: voiceDescription.trim() || null,
      targetAudience: targetAudience.trim() || null,
      defaultChannel: defaultChannel.trim() || null,
      defaultGoal: defaultGoal.trim() || null,
      voiceExamplesRight: normalizedRight,
      voiceExamplesWrong: normalizedWrong,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      pushToast({
        title: "Company profile saved",
        body: "Brand voice and prompt packet details were updated.",
      });
    },
  });

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted/30">
            <BookText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Company Profile</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Capture the reusable brand brief your agents should write from: how the brand sounds,
              who it is talking to, what each piece is trying to achieve, and concrete examples of
              work that feels right or wrong.
            </p>
          </div>
          <Button
            onClick={() => profileMutation.mutate()}
            disabled={!dirty || profileMutation.isPending}
          >
            {profileMutation.isPending ? "Saving..." : "Save profile"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Voice Packet</h2>
          </div>
          <div className="space-y-4">
            <Field label="Voice Description">
              <textarea
                className="min-h-[160px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
                placeholder="Describe how the brand sounds in plain language."
                value={voiceDescription}
                onChange={(event) => setVoiceDescription(event.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Effective packet: how we describe our voice, examples that feel exactly right,
              examples that feel wrong, who we are talking to, and what the piece must achieve.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Default Brief</h2>
          </div>
          <div className="space-y-4">
            <Field label="Target Audience">
              <textarea
                className="min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
                placeholder="Who this brand is speaking to."
                value={targetAudience}
                onChange={(event) => setTargetAudience(event.target.value)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Channel">
                <textarea
                  className="min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
                  placeholder="Newsletter, Instagram, sales page, etc."
                  value={defaultChannel}
                  onChange={(event) => setDefaultChannel(event.target.value)}
                />
              </Field>
              <Field label="Goal Of The Piece">
                <textarea
                  className="min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
                  placeholder="What the writing needs to achieve."
                  value={defaultGoal}
                  onChange={(event) => setDefaultGoal(event.target.value)}
                />
              </Field>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SampleListEditor
          label="Right Examples"
          helper="Add 5–10 strong writing samples that feel exactly right. These are the anchor references agents should imitate."
          values={voiceExamplesRight}
          onChange={setVoiceExamplesRight}
          emptyLabel="Paste a sample that nails the voice."
          maxItems={10}
        />
        <SampleListEditor
          label="Wrong Examples"
          helper="Add up to 3 examples that feel wrong. Use these to define tone boundaries and failure modes."
          values={voiceExamplesWrong}
          onChange={setVoiceExamplesWrong}
          emptyLabel="Paste a sample that misses the voice, with the problems left visible."
          maxItems={3}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">How Agents Should Use This</h2>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>1. Start with the voice description.</p>
          <p>2. Read the “right” samples as the target feel.</p>
          <p>3. Read the “wrong” samples as guardrails.</p>
          <p>4. Use audience, channel, and goal to shape the final piece.</p>
        </div>
      </div>
    </div>
  );
}
