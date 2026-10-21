# Title: OCMS Authorization Matrix

Defines what Claude and contributors may do autonomously, must ask about, or must never do without written approval.

Status: Proposed
Last updated: 2026-10-20

## Tiers

| Tier | Name | Autonomy |
|---|---|---|
| T0 | Read | Autonomous |
| T1 | Docs | Autonomous |
| T2 | Code | Autonomous only if the task authorizes implementation |
| T3 | Ask first | Record a Proposed decision, wait for owner approval |
| T4 | Forbidden without written approval | Stop; never proceed on inference |

## Action matrix

| Action | Tier | Approval | Record in |
|---|---|---|---|
| Read source, docs, configuration (never secret values) | T0 | None | n/a |
| Run read-only commands | T0 | None | n/a |
| Create or edit documentation | T1 | None | current-state.md |
| Edit source within task scope | T2 | Task authorizes implementation | current-state.md |
| Run tests, linters, builds | T2 | Task authorizes implementation | testing.md |
| Add a dependency | T3 | Owner approval | decisions.md |
| Adopt a third-party service | T3 | Owner approval | decisions.md |
| Introduce a material data flow | T3 | Owner approval | decisions.md, data-security.md |
| Database schema migration | T3 | Owner approval plus rollback plan | decisions.md, backend-schema.md |
| Change CI/CD configuration | T3 | Owner approval | decisions.md |
| Delete files or directories | T3 | Owner approval | current-state.md |
| Change privacy or data-collection behavior | T3 | Owner approval | decisions.md, security.md |
| Weaken a security control | T4 | Written owner approval | decisions.md |
| Handle or rotate secrets | T4 | Written owner approval | secrets.md (names only) |
| Deploy to production | T4 | Written owner approval | production release checklist |
| Modify production data or access permissions | T4 | Written owner approval | decisions.md |
| Destructive operations (force push, drop, recursive delete) | T4 | Written owner approval | decisions.md |
| Expose or transmit secrets | T4 | Never permitted | n/a |

## Enforcement mapping

`.claude/settings.json` implements this matrix: `allow` covers T0 and T1, `ask` covers T2 and T3, `deny` covers T4 and secret paths. The file is a starting point; **Open**: review and tighten per project.

## Approval record

| ID | Action | Requested by | Approved by | Date | Scope | Expiry |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |
