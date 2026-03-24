# Learnings

## [LRN-20260323-001] correction

**Logged**: 2026-03-23T19:36:30-07:00
**Priority**: medium
**Status**: pending
**Area**: config

### Summary
Do not trust previously bound social credentials as the authoritative account username when the user corrects the target handle.

### Details
A live TikTok login check used the username currently stored in the Paperclip secret store. The user corrected that value and specified that the correct TikTok username for this workflow is `@romanceunzipped`. Future social login validation should treat the user correction as the source of truth and rotate the bound secret before re-testing.

### Suggested Action
Rotate the bound TikTok username secret immediately when corrected, then rerun the login flow before updating issue status.

### Metadata
- Source: user_feedback
- Related Files: .env
- Tags: secrets, social, tiktok

---
