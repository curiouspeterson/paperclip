#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function usage() {
  console.log(`Usage: bin/sync_batch_to_paperclip.mjs --manifest PATH [--api-url URL] [--api-key TOKEN] [--issue-id ID] [--company-id ID] [--project-id ID]

Syncs generated batch outputs back into a Paperclip issue:
- upserts markdown issue documents
- uploads selected binary assets as issue attachments
- posts a summary comment for board review
- creates a review issue automatically when company scope is provided but no issue id is supplied

Defaults can come from the Paperclip heartbeat env:
- PAPERCLIP_API_URL
- PAPERCLIP_API_KEY
- PAPERCLIP_TASK_ID
- PAPERCLIP_COMPANY_ID
- PAPERCLIP_PROJECT_ID
`);
}

function parseArgs(argv) {
  const args = {
    manifest: "",
    apiUrl: process.env.PAPERCLIP_API_URL,
    apiKey: process.env.PAPERCLIP_API_KEY ?? "",
    issueId: process.env.PAPERCLIP_TASK_ID ?? "",
    companyId: process.env.PAPERCLIP_COMPANY_ID ?? "",
    projectId: process.env.PAPERCLIP_PROJECT_ID ?? "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    switch (value) {
      case "--manifest":
        args.manifest = argv[++i] ?? "";
        break;
      case "--api-url":
        args.apiUrl = argv[++i] ?? "";
        break;
      case "--api-key":
        args.apiKey = argv[++i] ?? "";
        break;
      case "--issue-id":
        args.issueId = argv[++i] ?? "";
        break;
      case "--company-id":
        args.companyId = argv[++i] ?? "";
        break;
      case "--project-id":
        args.projectId = argv[++i] ?? "";
        break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!args.manifest) {
    throw new Error("--manifest is required");
  }
  if (!args.apiUrl) {
    throw new Error("PAPERCLIP_API_URL required (via env or --api-url)");
  }
  if (!args.companyId && !args.issueId) {
    throw new Error("--company-id is required when creating a new issue (or set PAPERCLIP_COMPANY_ID). Provide --issue-id to update an existing issue.");
  }
  args.apiUrl = args.apiUrl.replace(/\/+$/, "");
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function expandUserAndResolve(input) {
  if (typeof input !== "string" || !input.trim()) {
    return "";
  }
  const expanded = input.startsWith("~/") || input === "~"
    ? path.join(os.homedir(), input.slice(1))
    : input;
  return path.resolve(expanded);
}

function resolveIfPresent(filePath) {
  return expandUserAndResolve(filePath);
}

function writeManifestAtomic(filePath, manifest) {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, filePath);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function basename(filePath) {
  return path.basename(filePath);
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mp4":
      return "video/mp4";
    case ".m4a":
      return "audio/mp4";
    case ".srt":
      return "application/x-subrip";
    case ".vtt":
      return "text/vtt";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function isSupportedAttachmentPath(filePath) {
  return /\.(png|jpe?g|json|srt|vtt|md|txt|csv|html|pdf)$/i.test(filePath);
}

async function apiFetch(apiUrl, apiKey, pathname, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  const response = await fetch(`${apiUrl}${pathname}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${init.method ?? "GET"} ${pathname} failed: ${response.status} ${text}`);
  }
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function getIssue(apiUrl, apiKey, issueId) {
  return apiFetch(apiUrl, apiKey, `/issues/${issueId}`);
}

async function createIssue(apiUrl, apiKey, companyId, payload) {
  return apiFetch(apiUrl, apiKey, `/companies/${companyId}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function getDocument(apiUrl, apiKey, issueId, key) {
  const response = await fetch(`${apiUrl}/issues/${issueId}/documents/${encodeURIComponent(key)}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GET /issues/${issueId}/documents/${key} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function upsertDocument(apiUrl, apiKey, issueId, key, title, body, changeSummary) {
  const existing = await getDocument(apiUrl, apiKey, issueId, key);
  return apiFetch(apiUrl, apiKey, `/issues/${issueId}/documents/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      format: "markdown",
      body,
      changeSummary,
      baseRevisionId: existing?.latestRevisionId ?? null,
    }),
  });
}

async function listAttachments(apiUrl, apiKey, issueId) {
  return apiFetch(apiUrl, apiKey, `/issues/${issueId}/attachments`);
}

async function uploadAttachment(apiUrl, apiKey, companyId, issueId, filePath) {
  const form = new FormData();
  const buffer = fs.readFileSync(filePath);
  form.append("file", new Blob([buffer], { type: guessContentType(filePath) }), basename(filePath));
  return apiFetch(apiUrl, apiKey, `/companies/${companyId}/issues/${issueId}/attachments`, {
    method: "POST",
    body: form,
  });
}

async function addComment(apiUrl, apiKey, issueId, body) {
  return apiFetch(apiUrl, apiKey, `/issues/${issueId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

function buildDocBody(sourcePath, introLabel) {
  return `${introLabel}\n\n_Source: \`${sourcePath}\`_\n\n${readText(sourcePath)}`;
}

function requireReadyStatuses(manifest, keys) {
  const status = manifest?.status ?? {};
  const missing = keys.filter((key) => String(status[key] ?? "").trim().toLowerCase() !== "ready");
  if (missing.length > 0) {
    throw new Error(
      `Sync requires ready statuses for: ${missing.join(", ")}. ` +
      `Complete the pipeline before syncing to Paperclip.`,
    );
  }
}

function attachmentCandidatesFromManifest(manifest) {
  const social = manifest?.targets?.social_poster ?? {};
  const clip = manifest?.targets?.clip_extractor ?? {};
  const newsletter = manifest?.targets?.newsletter_agent ?? {};
  const candidates = [
    // Board review bundle
    social.board_review_json_path,
    // Approval packet
    social.approval_packet_json_path,
    // Social drafts
    social.instagram_dry_run_json_path,
    newsletter.mailchimp_dry_run_json_path,
    // Newsletter draft
    newsletter.draft_json_path,
    // Clip pipeline
    clip.clip_candidates_json_path,
    clip.rendered_clips_json_path,
    clip.quote_candidates_path,
    clip.quote_cards_json_path,
    clip.rendered_clips_path,
  ].filter(Boolean);

  const files = [];
  for (const candidate of candidates) {
    const resolved = expandUserAndResolve(candidate);
    if (!resolved || !fs.existsSync(resolved)) {
      continue;
    }
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      files.push(resolved);
      continue;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(resolved)) {
        const nested = path.join(resolved, name);
        if (fs.statSync(nested).isFile() && isSupportedAttachmentPath(nested)) {
          files.push(nested);
        }
      }
    }
  }
  return files;
}

function pickKeyAssets(manifest) {
  const social = manifest?.targets?.social_poster ?? {};
  const clip = manifest?.targets?.clip_extractor ?? {};
  const approvalPacketJsonPath = resolveIfPresent(social.approval_packet_json_path);
  let leadAsset = "";
  let quoteCard = "";
  if (approvalPacketJsonPath && fs.existsSync(approvalPacketJsonPath)) {
    const packet = readJson(approvalPacketJsonPath);
    if (packet?.lead_asset?.preview_path) {
      leadAsset = expandUserAndResolve(packet.lead_asset.preview_path);
    }
    if (packet?.lead_asset?.quote_card_path) {
      quoteCard = expandUserAndResolve(packet.lead_asset.quote_card_path);
    }
  }
  const boardReviewJson = resolveIfPresent(social.board_review_json_path);
  return [leadAsset, quoteCard, boardReviewJson].filter((value) => value && fs.existsSync(value));
}

async function syncAttachments(apiUrl, apiKey, companyId, issueId, filePaths) {
  const existing = await listAttachments(apiUrl, apiKey, issueId);
  const existingBySha = new Set(existing.map((attachment) => attachment.sha256));
  const uploaded = [];

  for (const filePath of filePaths) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || !isSupportedAttachmentPath(filePath)) {
      continue;
    }
    const sha = sha256File(filePath);
    if (existingBySha.has(sha)) {
      continue;
    }
    const attachment = await uploadAttachment(apiUrl, apiKey, companyId, issueId, filePath);
    uploaded.push({
      id: attachment.id,
      filename: attachment.originalFilename ?? basename(filePath),
      contentPath: attachment.contentPath,
    });
    existingBySha.add(sha);
  }
  return uploaded;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = expandUserAndResolve(args.manifest);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);

  // Mark stage as running before any API work
  manifest.status = manifest.status ?? {};
  manifest.status.paperclip_sync = "running";
  manifest.updated_at = new Date().toISOString();
  writeManifestAtomic(manifestPath, manifest);

  // Gate: require the full review bundle to be ready before any API call
  requireReadyStatuses(manifest, [
    "board_review",
    "approval_packet",
    "social_drafts",
    "newsletter_draft",
    "instagram_dry_run",
    "mailchimp_dry_run",
  ]);

  let issue = null;
  if (args.issueId) {
    issue = await getIssue(args.apiUrl, args.apiKey, args.issueId);
    // Backfill companyId from existing issue for attachment uploads and metadata
    if (issue?.companyId && !args.companyId) {
      args.companyId = issue.companyId;
    }
  } else {
    const title = String(manifest?.title || manifest?.episode_id || "Episode batch review").trim();
    issue = await createIssue(args.apiUrl, args.apiKey, args.companyId, {
      projectId: args.projectId || null,
      title: `Review batch: ${title}`,
      description: `Auto-created from episode batch sync for \`${manifest?.episode_id ?? title}\`.\n\nManifest: \`${manifestPath}\``,
      status: "backlog",
      priority: "medium",
    });
    args.issueId = issue.id;
  }

  const social = manifest?.targets?.social_poster ?? {};
  const newsletter = manifest?.targets?.newsletter_agent ?? {};
  const clip = manifest?.targets?.clip_extractor ?? {};
  const operations = manifest?.targets?.operations ?? {};

  // Required documents — fail hard if any path is missing
  const requiredDocSpecs = [
    {
      key: "board_review",
      title: "Board Review",
      path: resolveIfPresent(social.board_review_path),
      intro: "# Board Review\n",
      changeSummary: "Synced generated board review bundle from episode batch",
    },
    {
      key: "approval_packet",
      title: "Approval Packet",
      path: resolveIfPresent(social.approval_packet_path),
      intro: "# Approval Packet\n",
      changeSummary: "Synced generated approval packet from episode batch",
    },
    {
      key: "instagram_reel_draft",
      title: "Instagram Reel Draft",
      path: resolveIfPresent(social.instagram_reel_path),
      intro: "# Instagram Reel Draft\n",
      changeSummary: "Synced Instagram reel draft from episode batch",
    },
    {
      key: "facebook_post_draft",
      title: "Facebook Post Draft",
      path: resolveIfPresent(social.facebook_post_path),
      intro: "# Facebook Post Draft\n",
      changeSummary: "Synced Facebook post draft from episode batch",
    },
    {
      key: "tiktok_post_draft",
      title: "TikTok Post Draft",
      path: resolveIfPresent(social.tiktok_post_path),
      intro: "# TikTok Post Draft\n",
      changeSummary: "Synced TikTok post draft from episode batch",
    },
    {
      key: "newsletter_draft",
      title: "Newsletter Draft",
      path: resolveIfPresent(newsletter.draft_path),
      intro: "# Newsletter Draft\n",
      changeSummary: "Synced newsletter draft from episode batch",
    },
    {
      key: "instagram_dry_run",
      title: "Instagram Dry Run",
      path: resolveIfPresent(social.instagram_dry_run_path),
      intro: "# Instagram Dry Run\n",
      changeSummary: "Synced Instagram dry-run packet from episode batch",
    },
    {
      key: "mailchimp_dry_run",
      title: "Newsletter (Mailchimp) Dry Run",
      path: resolveIfPresent(newsletter.mailchimp_dry_run_path),
      intro: "# Newsletter Dry Run\n",
      changeSummary: "Synced newsletter dry-run packet from episode batch",
    },
    {
      key: "clip_candidates",
      title: "Clip Candidates",
      path: resolveIfPresent(clip.clip_candidates_path),
      intro: "# Clip Candidates\n",
      changeSummary: "Synced clip candidates from episode batch",
    },
    {
      key: "quote_candidates",
      title: "Quote Candidates",
      path: resolveIfPresent(clip.quote_candidates_path),
      intro: "# Quote Candidates\n",
      changeSummary: "Synced quote candidates from episode batch",
    },
    {
      key: "rendered_clips",
      title: "Rendered Clips",
      path: resolveIfPresent(clip.rendered_clips_path),
      intro: "# Rendered Clips\n",
      changeSummary: "Synced rendered clip manifest from episode batch",
    },
    {
      key: "quote_cards",
      title: "Quote Cards",
      path: resolveIfPresent(clip.quote_cards_path),
      intro: "# Quote Cards\n",
      changeSummary: "Synced quote-card specs from episode batch",
    },
  ];

  // Optional connector runbook documents
  const optionalDocSpecs = [
    {
      key: "riverside_runbook",
      title: "Riverside Runbook",
      path: resolveIfPresent(operations.riverside_runbook_path),
      intro: "# Riverside Runbook\n",
      changeSummary: "Synced Riverside non-live runbook from episode batch",
    },
    {
      key: "vercel_runbook",
      title: "Vercel Runbook",
      path: resolveIfPresent(operations.vercel_runbook_path),
      intro: "# Vercel Runbook\n",
      changeSummary: "Synced Vercel deployment runbook from episode batch",
    },
    {
      key: "fable_runbook",
      title: "Fable Runbook",
      path: resolveIfPresent(operations.fable_runbook_path),
      intro: "# Fable Runbook\n",
      changeSummary: "Synced Fable non-live runbook from episode batch",
    },
  ];

  // Fail hard if any required document path is missing or does not exist
  const missingRequired = requiredDocSpecs.filter((spec) => !spec.path || !fs.existsSync(spec.path));
  if (missingRequired.length > 0) {
    throw new Error(
      `Sync aborted: required documents are missing: ${missingRequired.map((s) => s.key).join(", ")}`,
    );
  }

  const docSpecs = [
    ...requiredDocSpecs,
    ...optionalDocSpecs.filter((spec) => spec.path && fs.existsSync(spec.path)),
  ];

  const syncedDocuments = [];
  for (const spec of docSpecs) {
    await upsertDocument(
      args.apiUrl,
      args.apiKey,
      args.issueId,
      spec.key,
      spec.title,
      buildDocBody(spec.path, spec.intro),
      spec.changeSummary,
    );
    syncedDocuments.push(spec);
  }

  const attachmentCandidates = Array.from(new Set([
    ...pickKeyAssets(manifest),
    ...attachmentCandidatesFromManifest(manifest),
  ]));
  const uploaded = await syncAttachments(args.apiUrl, args.apiKey, args.companyId, args.issueId, attachmentCandidates);

  const identifier = issue?.identifier ?? args.issueId;
  const lines = [
    "## Batch Sync",
    "",
    `Synced the latest pre-publish batch artifacts for \`${manifest.episode_id ?? "episode"}\` into Paperclip.`,
    "",
    "- Documents updated:",
  ];
  for (const doc of syncedDocuments) {
    lines.push(`  - \`${doc.key}\` from \`${doc.path}\``);
  }
  if (uploaded.length > 0) {
    lines.push("- Attachments uploaded:");
    for (const attachment of uploaded) {
      lines.push(`  - \`${attachment.filename}\` (${attachment.contentPath})`);
    }
  } else {
    lines.push("- Attachments uploaded: none (existing matching assets already present)");
  }
  lines.push(`- Source issue: \`${identifier}\``);

  await addComment(args.apiUrl, args.apiKey, args.issueId, `${lines.join("\n")}\n`);

  // Write sync metadata and final status atomically
  const syncedAt = new Date().toISOString();
  manifest.governance = manifest.governance ?? {};
  manifest.governance.paperclip_issue_id = args.issueId;
  manifest.governance.board_review_synced_at = syncedAt;
  manifest.status.paperclip_sync = "ready";
  manifest.updated_at = syncedAt;
  writeManifestAtomic(manifestPath, manifest);

  console.log(
    JSON.stringify(
      {
        issueId: args.issueId,
        companyId: args.companyId,
        syncedDocuments: syncedDocuments.map((doc) => doc.key),
        uploadedAttachments: uploaded.map((attachment) => attachment.filename),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  // Attempt to mark sync as failed in the manifest so the manifest does not look successful
  try {
    const manifestPath = expandUserAndResolve(
      process.argv[process.argv.indexOf("--manifest") + 1] ?? "",
    );
    if (manifestPath && fs.existsSync(manifestPath)) {
      const manifest = readJson(manifestPath);
      manifest.status = manifest.status ?? {};
      if (manifest.status.paperclip_sync !== "ready") {
        manifest.status.paperclip_sync = "failed";
        manifest.updated_at = new Date().toISOString();
        writeManifestAtomic(manifestPath, manifest);
      }
    }
  } catch {
    // best-effort; ignore errors in failure handler
  }
  process.exit(1);
});
