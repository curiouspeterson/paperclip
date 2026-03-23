## [ERR-20260323-001] shell quoting in rg command

**Logged**: 2026-03-23T15:40:00-07:00
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
An `rg` command failed because the shell pattern included mismatched quotes.

### Error
```text
zsh:1: unmatched "
```

### Context
- Command/operation attempted: ad hoc `rg` search over issue comment API usages
- Input or parameters used: nested quotes around a regex/pattern argument
- Environment details if relevant: Codex desktop session using `zsh`

### Suggested Fix
Prefer simpler quoted patterns or separate `rg` invocations when the search string contains backticks or mixed quotes.

### Metadata
- Reproducible: yes
- Related Files: none

---
