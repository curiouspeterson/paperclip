# Company Profile Design

Date: 2026-03-23

## Goal

Add a first-class company profile page that stores reusable brand-writing context:

- short voice description
- target audience
- default channel
- goal of the piece
- 5–10 examples that feel right
- up to 3 examples that feel wrong

## Recommended Approach

Store the profile directly on the `companies` table instead of introducing a new company-profile table. This keeps the feature lightweight, company-scoped, and consistent with how other reusable company settings already work.

## Data Model

Add the following fields to `companies`:

- `voice_description` text nullable
- `target_audience` text nullable
- `default_channel` text nullable
- `default_goal` text nullable
- `voice_examples_right` jsonb string[] not null default `[]`
- `voice_examples_wrong` jsonb string[] not null default `[]`

## UI

Add a new `Profile` link under the `Company` sidebar section.

Add a dedicated `/company/profile` page with:

- a voice packet section
- a default brief section
- editable “right examples” list
- editable “wrong examples” list

This keeps Company Settings focused on operational/platform settings while Company Profile becomes the reusable prompt packet editor.

## Validation

- allow empty state during initial setup
- cap “right examples” at 10
- cap “wrong examples” at 3
- trim empty entries before save

## Notes

This is intentionally company-level only. Per-piece prompt packets can be layered later on top of this shared brand profile.
