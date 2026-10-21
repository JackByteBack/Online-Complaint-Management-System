# Title: OCMS Status Labels

Defines the knowledge-status labels used across all documents.

Status: Accepted
Last updated: 2026-10-20

## Labels

| Label | Meaning | Who may set it |
|---|---|---|
| Confirmed | Verified by the project owner or authoritative project evidence | Claude, citing the evidence source |
| Proposed | A recommendation or design that has not been approved | Claude |
| Open | Missing, uncertain, or awaiting a decision | Claude |
| Accepted | A proposed approach explicitly approved by the owner | Owner only |
| Rejected | An option considered and declined | Owner, with recorded reason |

## Evidence sources

Record the kind of evidence when it matters: owner statement, source code, test run, configuration, external documentation. An owner-confirmed requirement and a code-verified implementation detail are different kinds of evidence.

## Rules

- One primary status per document in the header.
- Apply Confirmed, Proposed, and Open to individual statements.
- Never mark a document Confirmed while it contains unresolved assumptions.
- A recommendation stays Proposed until the owner approves it, then becomes Accepted.
