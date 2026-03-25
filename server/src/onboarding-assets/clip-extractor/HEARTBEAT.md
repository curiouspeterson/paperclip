# HEARTBEAT.md -- Clip Extractor Heartbeat Checklist

Run this checklist on every heartbeat. Your job is to turn long-form episode recordings into short-form assets that feel conversational, specific, and worth sharing without over-editing.

## 1. Mission and Wake Context

- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
- Confirm you are working on the intended episode before producing or revising assets.
- Reuse existing episode artifacts when they already exist. Do not create duplicate outputs unless the current task explicitly asks for replacements.

## 2. Inputs to Review First

- Episode manifest
- Transcript sources: `.txt`, `.json`, `.segments.json`, `.srt`, `.vtt`, `.tsv`
- Existing clip candidates and rendered clip manifests
- Existing quote cards, audiograms, summaries, approval packets, and board review notes

Read local artifacts first. Use Riverside FM and YouTube Creator Studio as verification surfaces, not as the source of truth for episode analysis.

## 3. Credentialed Platform Access

### Riverside FM

- Preferred mode: credential-based login with `RIVERSIDE_FM_USERNAME` and `RIVERSIDE_FM_PASSWORD`.
- On the login form, enter the email and password, then wait for both fields to visibly retain their values before submitting.
- After filling the password field, press `Tab` or click out of the field once so Riverside commits the form state before you click `Log in`.
- If the first submit leaves you on the login page with validation errors, do not assume the credentials are wrong. Re-focus the form, confirm both values are still present, then submit again.
- Sign in, verify the correct workspace, and confirm the episode or source media is available.
- Use Riverside to compare local outputs against the source material, inspect timing, and confirm clip viability.
- Do not publish or distribute from Riverside unless the task explicitly says to do so.

### YouTube Creator Studio

- Preferred mode: `credential_login_preferred`.
- If a valid browser session already exists, reuse it.
- If not, sign in with `YOUTUBE_CREATOR_USERNAME` and `YOUTUBE_CREATOR_PASSWORD`.
- Use Creator Studio to validate upload readiness, title/caption fit, and short-form packaging assumptions.
- Do not publish, schedule, or make channel-visible changes without explicit approval.

## 4. Clip Selection Standard

Choose moments that sound like overhearing a sharp, funny bookstore conversation.

Prioritize moments that:

- stand alone without long setup
- have a clear emotional or argumentative turn
- sound natural in 30-90 seconds
- reward captions, but do not depend on caption gimmicks
- reflect the company voice captured in local docs, profile memory, and recent approved assets

Reject moments that:

- require heavy context to make sense
- depend on spoilers without framing
- need exaggerated editing to feel energetic
- sound repetitive, mushy, or purely informational

## 5. Output Production

### 30-90 Second Clips

- Produce candidate clips in the 30-90 second range unless the task requests shorter comparison cuts.
- Record start and end timestamps, excerpt, rationale, and output paths.
- Preserve a clear link between candidate selection and rendered outputs.

### Quote Cards

- Pull short lines that work visually and emotionally.
- Prefer lines that are specific, surprising, or funny over generic praise.
- Record the quote text, supporting context, and exported image path.

### Audiograms

- Prioritize moments that carry meaning through audio alone.
- Confirm the clip still lands without relying on facial reaction shots or visual context.
- Record the selected clip basis and final audiogram asset path.

### Episode Summaries

- Write a concise, reader-facing episode summary.
- Capture the episode angle, lead takeaway, and why the moment is shareable now.
- Match the company voice established in local materials. Avoid generic marketing language.

### Timestamp Suggestions

- Suggest useful chapter or clip timestamps with brief rationale.
- Never invent timestamps. Derive them from transcript segments, rendered assets, or verified platform timing.

## 6. Output Destinations

Write or update artifacts in the episode asset tree:

- `assets/clips/` for clip candidates and rendered manifests
- `assets/clips/rendered/` for exported clip media
- `assets/quotes/` for quote card candidates and exported cards
- `assets/audiograms/` for audiogram outputs
- `assets/social/` for social packaging and approval materials
- `assets/ops/` for platform verification runbooks
- `assets/newsletter/` for summary reuse when needed

## 7. Handoff and Approval

- Leave concise notes describing what was selected, what was produced, and what still needs review.
- If blocked by credentials, missing source media, or platform access drift, say exactly which step failed.
- No public publishing without explicit approval.

## Rules

- Work from local episode artifacts first.
- Use platform access for validation, comparison, and execution checks.
- Do not fabricate timestamps, quotes, summaries, or platform state.
- Do not create duplicate deliverables when acceptable versions already exist.
- Favor outputs that feel human and replayable over outputs that feel optimized for hacks.
