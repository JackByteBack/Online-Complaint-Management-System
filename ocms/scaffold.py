#!/usr/bin/env python3
"""Project Doc Blueprint scaffold (v3.0).

Generates a documentation tree from the Project Doc Blueprint, selects
conditional documents by trigger, builds the README index last, and validates
headers, links, index coverage and accidental secrets.

Usage:
  python scaffold.py list
  python scaffold.py init --name "My App" --preset web-app --out ../my-app
  python scaffold.py init --name "My App" --triggers ui,db,auth --also setup
  python scaffold.py readme            # refresh the README index in place
  python scaffold.py validate          # exit code 1 on errors
"""
import argparse
import datetime
import pathlib
import re
import shutil
import sys

KIT = pathlib.Path(__file__).resolve().parent
STATUSES = ("Draft", "Confirmed", "Accepted", "Proposed", "Open")
IDX_START, IDX_END = "<!-- INDEX:START -->", "<!-- INDEX:END -->"

TRIGGERS = {
    "ui": "Screens or user interfaces",
    "ui-deep": "Large UI needing a standalone design philosophy and UI architecture",
    "roles": "Multiple user roles",
    "content": "User-facing text or generated content",
    "contentfmt": "Specific file or content formats the project reads or writes",
    "controls": "Safety-critical or special-behavior controls",
    "demo": "Time-boxed demo or deliverable",
    "arch": "Components and architectural boundaries",
    "tech": "Selected technologies or external services",
    "layout": "Required directory layout",
    "style": "Defined coding conventions",
    "db": "Database or persistent data store",
    "api": "API or service interface",
    "jobs": "Queued or asynchronous work",
    "schedule": "Scheduled tasks",
    "devsetup": "Local developer setup",
    "testing": "Automated testing or QA",
    "pr": "Pull-request workflow",
    "deploy": "Hosting, environments, or releases",
    "plan": "Multi-stage implementation plan",
    "sensitive": "Personal, confidential, or sensitive data",
    "auth": "Login, roles, permissions, or sessions",
    "secrets": "Secret keys, tokens, or credentials",
    "incident": "Meaningful ongoing incident risk",
    "alternatives": "Significant architectural alternatives",
    "flows": "Complex application flows",
    "monitoring": "Monitoring and operational requirements",
    "dataflow": "Distinct security-sensitive data flows",
    "defects": "Significant unresolved defects",
    "review": "Formal security review or exposure tracking",
    "roadmap": "Multi-release product direction",
    "research": "Open product or technical research",
}

PRESETS = {
    "minimal": [],
    "web-app": ["ui", "content", "arch", "tech", "layout", "style", "devsetup",
                "testing", "deploy", "plan", "flows"],
    "api": ["arch", "tech", "db", "api", "auth", "sensitive", "secrets", "devsetup",
            "testing", "pr", "deploy", "monitoring", "plan"],
    "full": list(TRIGGERS),
}

# ---------------------------------------------------------------- catalog
# Section tuple: (heading, hint, columns=None, status="Open", rows=None)
CATALOG = []


def D(name, folder, title, purpose, trig, sections=None, merged_into=None,
      status="Draft", body=None):
    CATALOG.append(dict(name=name, folder=folder, title=title, purpose=purpose,
                        trig=trig, sections=sections or [], merged_into=merged_into,
                        status=status, body=body))


TRIGGER_ROWS = [[d, "Open", k] for k, d in TRIGGERS.items()]

# ---- core
D("project-intake", "core", "Project Intake",
  "Captures the facts and needs that drive documentation selection.", "core", [
    ("Project name and purpose", "One paragraph. Source: owner."),
    ("Target users and their needs", "Who uses it and what they need. Source: owner."),
    ("Main features and intended outcomes", "Separate proposed features from implemented ones."),
    ("Current implementation and development stage", "Idea, prototype, in build, live. Cite repository evidence."),
    ("Technologies and frameworks", "Verified from manifests; unverified items stay Open."),
    ("Data collected, generated, stored, or transmitted", "List data classes, not real records."),
    ("User roles and permissions", "Roles and what each may do."),
    ("External integrations", "Each needs a decision entry before use (Rule 7)."),
    ("Security and privacy requirements", "Legal, contractual, or owner requirements."),
    ("Existing documentation and conventions", "What already exists and must be preserved (Rule 10)."),
    ("Deployment and operational requirements", "Hosting, environments, uptime, budget."),
    ("Trigger checklist", "Mark each characteristic Yes or No, then pass the flags to scaffold.py.",
     ["Characteristic", "Present?", "Flag"], "Open", TRIGGER_ROWS),
])
D("instructions", "core", "Project Instructions",
  "Project-specific rules for AI-assisted work and engineering collaboration.", "core", [
    ("Read-first documentation", "Ordered list of docs to read before any change.", None, "Proposed"),
    ("Repository-specific rules", "Conventions verified in the repo."),
    ("Implementation constraints", "Frameworks, versions, forbidden patterns."),
    ("Security requirements", "Reference security.md; list non-negotiables."),
    ("Testing expectations", "Reference testing.md; what must pass before done."),
    ("Documentation maintenance rules", "Which docs to update after which changes.", None, "Proposed"),
    ("Permission boundaries", "Reference docs/security/authorization-matrix.md.", None, "Proposed"),
    ("Definition of done", "Checklist for finished work."),
    ("Rules for asking questions", "Ask only when the repo cannot answer and it materially matters.", None, "Proposed"),
    ("Rules for handling uncertainty", "Mark Open, do not guess, do not fabricate.", None, "Proposed"),
])
D("agents", "core", "Coding Agent Rules",
  "Rules and constraints for coding agents and collaborators.", "core", [
    ("Read-first documentation", "Files an agent reads at session start.", None, "Proposed"),
    ("Agent recognition", "Which file the intended agent actually loads (CLAUDE.md, AGENTS.md). Verify; do not assume."),
    ("Development constraints", "Allowed commands, scope limits, branch rules."),
    ("Authorization tiers", "Summarize T0 to T4 from the authorization matrix.", None, "Proposed"),
    ("Definition of done", "Tests run, docs updated, current-state.md updated."),
])
D("current-state", "core", "Current State",
  "Verified project status, progress, open items, blockers, and known issues.", "core", [
    ("Current phase", "Single phase name with evidence."),
    ("Verified implementation status", "Only what is verified in code or tests."),
    ("Completed work", "Dated entries with evidence links."),
    ("In-progress work", "Owner and status per item."),
    ("Open items", "Every significant open item, with impact and whether it blocks."),
    ("Known issues", "Track each issue in one table.",
     ["ID", "Issue", "Impact", "Owner", "Status"]),
    ("Technical debt", "Known shortcuts and their cost."),
    ("Immediate blockers", "What stops progress and who can unblock."),
    ("Next actions", "Ordered, concrete next steps."),
])
D("decisions", "core", "Decisions",
  "Accepted decisions, rejected alternatives, and pending decisions with rationale.", "core", [
    ("Accepted", "Never delete; supersede with a new entry (Rule 5).",
     ["ID", "Date", "Decision", "Reason", "Status"]),
    ("Rejected Options", "Options considered and declined.",
     ["ID", "Option", "Reason Rejected", "Related Decision"]),
    ("Pending", "A recommendation stays Proposed until the owner approves.",
     ["ID", "Decision Needed", "Options", "Recommendation", "Decision Owner", "Status"]),
])
D("prd", "core", "Product Requirements",
  "Problem, users, goals, scope, requirements, and success criteria.", "core", [
    ("Problem statement", "What problem, for whom, why now."),
    ("Target users", "Reference define-the-user.md if present."),
    ("User needs", "Needs, not solutions."),
    ("Product goals", "Measurable where possible."),
    ("Non-goals", "Explicitly out of scope."),
    ("Scope", "In scope for this release."),
    ("Functional requirements", "Mark each Confirmed or Proposed.", ["ID", "Requirement", "Status", "Source"]),
    ("Non-functional requirements", "Performance, accessibility, privacy, availability.", ["ID", "Requirement", "Status", "Source"]),
    ("Acceptance criteria", "Testable statements mapped to requirement IDs."),
    ("Success metrics", "How success is measured and by when."),
    ("Constraints", "Budget, time, platform, legal."),
    ("Dependencies", "Each needs a decision entry (Rule 7)."),
    ("Open questions", "Unresolved requirements."),
])
D("glossary", "core", "Glossary",
  "Domain terminology, abbreviations, and identifiers.", "core", [
    ("Terms", "Create only if the domain has real terminology.", ["Term", "Definition", "Source"]),
])
D("status-labels", "core", "Status Labels",
  "Defines the knowledge-status labels used across all documents.", "core",
  status="Accepted", body=[
    "## Labels", "",
    "| Label | Meaning | Who may set it |", "|---|---|---|",
    "| Confirmed | Verified by the project owner or authoritative project evidence | Claude, citing the evidence source |",
    "| Proposed | A recommendation or design that has not been approved | Claude |",
    "| Open | Missing, uncertain, or awaiting a decision | Claude |",
    "| Accepted | A proposed approach explicitly approved by the owner | Owner only |",
    "| Rejected | An option considered and declined | Owner, with recorded reason |",
    "",
    "## Evidence sources", "",
    "Record the kind of evidence when it matters: owner statement, source code, test run, configuration, external documentation. An owner-confirmed requirement and a code-verified implementation detail are different kinds of evidence.",
    "",
    "## Rules", "",
    "- One primary status per document in the header.",
    "- Apply Confirmed, Proposed, and Open to individual statements.",
    "- Never mark a document Confirmed while it contains unresolved assumptions.",
    "- A recommendation stays Proposed until the owner approves it, then becomes Accepted.",
])

# ---- product
D("idea", "product", "Idea", "Original concept and motivation before requirements.", "research", [
    ("Concept", "What the idea is, in the owner's words."), ("Motivation", "Why it matters.")])
D("research", "product", "Research", "Findings from market, user, or technical research.", "research", [
    ("Questions", "What needs answering.", ["ID", "Question", "Method", "Status"]),
    ("Findings", "Each finding cites its source; unverified items stay Open.")])
D("define-the-user", "product", "User Definition", "Who the users are, what they need, and their constraints.", "ui", [
    ("Primary users", "Roles, goals, context."), ("Pain points", "Observed or owner-stated; label which."),
    ("Constraints", "Devices, connectivity, accessibility needs.")], merged_into="prd")
D("user-journeys", "product", "User Journeys", "End-to-end flows each user role follows.", ["ui", "roles"], [
    ("Journey inventory", "One section per role; mark each flow Confirmed or Proposed.", ["ID", "Role", "Goal", "Status"]),
    ("Flow detail", "Steps, entry points, success and failure states.")])
D("admin-journeys", "product", "Admin Journeys", "Flows for administrators and operators.", "roles", [
    ("Admin tasks", "Tasks, required permissions, audit expectations.", ["ID", "Task", "Permission", "Status"])])
D("app-flow", "product", "Application Flow", "Complex application flows and state transitions.", "flows", [
    ("Primary flow", "Include a Mermaid diagram that matches the implementation."),
    ("State transitions", "Valid states and guards."), ("Failure paths", "What happens on error.")])
D("demo", "product", "Demo Plan", "Scope and script for a time-boxed demo or deliverable.", "demo", [
    ("Deadline and audience", "Date and who sees it."), ("Demo scope", "What is shown and what is deliberately cut."),
    ("Script", "Ordered steps with fallback if something fails.")])
D("roadmap", "product", "Roadmap", "Planned direction across releases.", "roadmap", [
    ("Now / Next / Later", "Mark all future items Proposed.", ["Horizon", "Item", "Status"])])
D("iteration", "product", "Iteration Log", "How feedback becomes changes between releases.", "roadmap", [
    ("Feedback intake", "Where feedback arrives and who triages.")], merged_into="roadmap")
D("content-guidelines", "product", "Content Guidelines", "Voice, tone, and rules for user-facing and generated text.", "content", [
    ("Voice and tone", "Definitions with examples."), ("Terminology", "Reference glossary.md."),
    ("Generated content rules", "Review, labeling, and safety rules for generated text.")])
D("file-content-format", "product", "File and Content Formats", "Formats the project reads or writes.", "contentfmt", [
    ("Formats", "Format, schema, validation, example with synthetic data.", ["Format", "Schema", "Validation", "Status"])])

# ---- architecture
D("architecture", "architecture", "Architecture", "Components, boundaries, data flows, and trust boundaries.", "arch", [
    ("System overview", "Describe the existing implementation accurately."),
    ("Components and responsibilities", "One row per component.", ["Component", "Responsibility", "Boundary", "Status"]),
    ("External integrations", "Each approved in decisions.md."),
    ("Data flows", "Sources, sinks, data classes."),
    ("Trust boundaries", "Where trust changes."),
    ("Failure points", "What breaks and what happens."),
    ("Scalability considerations", "Known limits."),
    ("Security considerations", "Reference threat-model.md."),
    ("Architecture diagram", "Mermaid. Must match the real system.", None, "Open"),
    ("Proposed future architecture", "Keep separate from current architecture.", None, "Proposed"),
])
D("technology", "architecture", "Technology", "Selected technologies, versions, and rationale.", "tech", [
    ("Technology inventory", "Verified versions only.",
     ["Technology", "Version", "Purpose", "Reason selected", "Alternatives", "Approval"]),
    ("Compatibility constraints", "Version and platform limits."),
    ("Operational and security implications", "Cost, hosting, supply chain."),
    ("Technology diagram", "Mermaid, when it clarifies interactions.")])
D("backend-schema", "architecture", "Backend Schema", "Entities, fields, relationships, sensitivity, and retention.", "db", [
    ("Entities", "Fields, types, keys.", ["Entity", "Fields", "Keys", "Sensitivity", "Status"]),
    ("Relationships and constraints", "Foreign keys, indexes."),
    ("Retention and access", "How long, who can read or write."),
    ("Audit requirements", "What must be logged."),
    ("Migration considerations", "Ordering, rollback, data safety.")])
D("api", "architecture", "API", "Endpoints, access rules, and error formats.", "api", [
    ("Endpoints", "Verified against code; unverified stays Open.", ["Method", "Path", "Access", "Status"]),
    ("Error format", "Shape and codes."), ("Versioning and rate limits", "Policy.")])
D("project-structure", "architecture", "Project Structure", "Required directory layout and conventions.", "layout", [
    ("Directory layout", "Verified tree with the purpose of each directory."),
    ("Placement rules", "Where new files go.")])
D("background-jobs", "architecture", "Background Jobs", "Queued and asynchronous work.", "jobs", [
    ("Jobs", "Trigger, retries, idempotency, failure handling.", ["Job", "Trigger", "Retry policy", "Status"])])
D("scheduled-tasks", "architecture", "Scheduled Tasks", "Scheduled behavior and ownership.", "schedule", [
    ("Schedules", "Cron, owner, expected duration, failure alert.", ["Task", "Schedule", "Owner", "Status"])])
D("rejected-options", "architecture", "Rejected Options", "Significant alternatives considered and declined.", "alternatives", [
    ("Options", "Link each to a decision ID.", ["ID", "Option", "Reason Rejected", "Related Decision"])])

# ---- design
D("design-system", "design", "Design System", "Visual language and reusable UI patterns.", "ui", [
    ("Design reference review", "Record whether https://getdesign.md was actually accessed. Unreviewed means Open."),
    ("Design philosophy", "Principles specific to this project."), ("Visual hierarchy", "What draws attention first."),
    ("Typography", "Families, scale, weights."), ("Color system", "Tokens and contrast ratios."),
    ("Spacing", "Scale and layout grid."), ("Responsive layouts", "Breakpoints and behavior."),
    ("Components", "Inventory and states."), ("Navigation", "Structure and patterns."),
    ("Interaction states", "Hover, focus, active, disabled."), ("Motion", "Durations, easing, reduced-motion."),
    ("Loading and error states", "Patterns."), ("Mobile performance", "Budgets.")])
D("design", "design", "Design Notes", "Design rationale and decisions for specific surfaces.", "ui-deep", [
    ("Rationale", "Why the design is the way it is.")], merged_into="design-system")
D("accessibility", "design", "Accessibility", "Accessibility requirements and verification.", "ui", [
    ("Target standard", "For example WCAG 2.2 AA. Mark Open until the owner confirms."),
    ("Verification", "Tools and manual checks actually run.")])
D("ui-architecture", "design", "UI Architecture", "Front-end structure, state, and rendering strategy.", "ui-deep", [
    ("Rendering strategy", "SSR, SSG, SPA. Verified from code."), ("State management", "Where state lives."),
    ("Component structure", "Layers and conventions.")])

# ---- engineering
D("code-style", "engineering", "Code Style", "Coding conventions and tooling.", "style", [
    ("Conventions", "Naming, formatting, linting. Verified from config files."),
    ("Tooling", "Formatter and linter commands.")])
D("development", "engineering", "Development", "Local developer setup and commands.", "devsetup", [
    ("Prerequisites", "Versions verified from manifests."), ("Setup steps", "Commands that match the real toolchain."),
    ("Environment variables", "Names only, never values. See secrets.md."), ("Common tasks", "Run, test, build.")])
D("setup", "engineering", "Setup", "Initial environment setup.", "devsetup", [
    ("Setup", "Prefer folding into development.md.")], merged_into="development")
D("testing", "engineering", "Testing", "Test strategy, layers, commands, and coverage.", "testing", [
    ("Test strategy", "What is tested and why."),
    ("Test layers", "Existing, planned, executed. Keep them distinct.", ["Layer", "Exists", "Executed", "Command"]),
    ("Acceptance criteria mapping", "Map PRD criteria to tests."),
    ("Test data and synthetic-data rules", "No production data."),
    ("Device and browser matrix", "When applicable."),
    ("Security and regression coverage", "Gaps are Open."),
    ("CI requirements", "Required checks."), ("Known testing gaps", "Honest list.")])
D("qa-testing", "engineering", "QA Testing", "Manual QA passes and results.", "testing", [
    ("QA passes", "Record only passes actually performed.", ["Date", "Scope", "Result", "Evidence"])], merged_into="testing")
D("code-review", "engineering", "Code Review", "Pull-request workflow and review checklist.", "pr", [
    ("Workflow", "Branching, reviewers, merge rules."), ("Review checklist", "Security, tests, docs, dependencies.")])
D("known-issues", "engineering", "Known Issues", "Unresolved defects with impact and ownership.", "defects", [
    ("Issues", "Move here when current-state.md gets crowded.", ["ID", "Issue", "Impact", "Owner", "Status"])])
D("critical-bugs", "engineering", "Critical Bugs", "Release-blocking defects.", "defects", [
    ("Critical bugs", "Evidence and mitigation per bug.", ["ID", "Bug", "Evidence", "Impact", "Status"])], merged_into="known-issues")
D("task-breakdown", "engineering", "Task Breakdown", "Milestones and tasks with dependencies.", "plan", [
    ("Milestones", "Track blockers.", ["ID", "Goal", "Blocked By", "Status"]),
    ("Tasks", "Each task has acceptance criteria elsewhere.", ["ID", "Task", "Milestone", "Depends On", "Status"])])
D("control-spec", "engineering", "Control Specification", "Dedicated specification for one safety-critical control (copy per control).", "controls", [
    ("Control", "Name and purpose."), ("Required behavior", "Exact, testable behavior."),
    ("Failure behavior", "What happens when the control fails."), ("Verification", "How it is tested.")])

# ---- security
D("authorization-matrix", "security", "Authorization Matrix",
  "Defines what Claude and contributors may do autonomously, must ask about, or must never do without written approval.", "core",
  status="Proposed", body=[
    "## Tiers", "",
    "| Tier | Name | Autonomy |", "|---|---|---|",
    "| T0 | Read | Autonomous |",
    "| T1 | Docs | Autonomous |",
    "| T2 | Code | Autonomous only if the task authorizes implementation |",
    "| T3 | Ask first | Record a Proposed decision, wait for owner approval |",
    "| T4 | Forbidden without written approval | Stop; never proceed on inference |",
    "",
    "## Action matrix", "",
    "| Action | Tier | Approval | Record in |", "|---|---|---|---|",
    "| Read source, docs, configuration (never secret values) | T0 | None | n/a |",
    "| Run read-only commands | T0 | None | n/a |",
    "| Create or edit documentation | T1 | None | current-state.md |",
    "| Edit source within task scope | T2 | Task authorizes implementation | current-state.md |",
    "| Run tests, linters, builds | T2 | Task authorizes implementation | testing.md |",
    "| Add a dependency | T3 | Owner approval | decisions.md |",
    "| Adopt a third-party service | T3 | Owner approval | decisions.md |",
    "| Introduce a material data flow | T3 | Owner approval | decisions.md, data-security.md |",
    "| Database schema migration | T3 | Owner approval plus rollback plan | decisions.md, backend-schema.md |",
    "| Change CI/CD configuration | T3 | Owner approval | decisions.md |",
    "| Delete files or directories | T3 | Owner approval | current-state.md |",
    "| Change privacy or data-collection behavior | T3 | Owner approval | decisions.md, security.md |",
    "| Weaken a security control | T4 | Written owner approval | decisions.md |",
    "| Handle or rotate secrets | T4 | Written owner approval | secrets.md (names only) |",
    "| Deploy to production | T4 | Written owner approval | production release checklist |",
    "| Modify production data or access permissions | T4 | Written owner approval | decisions.md |",
    "| Destructive operations (force push, drop, recursive delete) | T4 | Written owner approval | decisions.md |",
    "| Expose or transmit secrets | T4 | Never permitted | n/a |",
    "",
    "## Enforcement mapping", "",
    "`.claude/settings.json` implements this matrix: `allow` covers T0 and T1, `ask` covers T2 and T3, `deny` covers T4 and secret paths. The file is a starting point; **Open**: review and tighten per project.",
    "",
    "## Approval record", "",
    "| ID | Action | Requested by | Approved by | Date | Scope | Expiry |", "|---|---|---|---|---|---|---|",
    "| — | — | — | — | — | — | — |",
])
D("security", "security", "Security", "Security principles, data handling, privacy requirements, and responsibilities.", "sensitive", [
    ("Principles", "Proportionate to real risk."), ("Data classification", "Classes and handling rules.", ["Class", "Examples", "Handling", "Status"]),
    ("Privacy requirements", "Legal and owner requirements."), ("Responsibilities", "Who owns what."),
    ("Findings", "Evidence-based only.", ["ID", "Finding", "Evidence", "Impact", "Severity", "Mitigation", "Status"])])
D("auth", "security", "Authentication and Authorization", "Authentication mechanisms and access-control requirements.", ["auth", "roles"], [
    ("Authentication provider", "Open until confirmed."), ("Session management", "Proposed default: HTTP-only secure cookies if compatible.", None, "Proposed"),
    ("Roles and permissions", "Role to permission mapping.", ["Role", "Permissions", "Status"]),
    ("Access-control checks", "Where enforced and how verified.")])
D("data-security", "security", "Data Security", "Handling of distinct security-sensitive data flows.", "dataflow", [
    ("Sensitive data flows", "Source, sink, protection in transit and at rest.", ["Flow", "Data class", "Protection", "Status"])])
D("threat-model", "security", "Threat Model", "Assets, actors, trust boundaries, threats, and mitigations.", "sensitive", [
    ("Assets", "What is worth protecting."), ("Actors", "Legitimate and hostile."),
    ("Trust boundaries", "Reference architecture.md."),
    ("Attack surface", "Entry points."),
    ("Threats and mitigations", "Separate confirmed, suspected, and unverified.", ["ID", "Finding", "Evidence", "Impact", "Severity", "Mitigation", "Status"]),
    ("Residual risk", "Accepted risks with owner.")])
D("attack-surface", "security", "Attack Surface", "Inventory of externally reachable entry points.", "sensitive", [
    ("Entry points", "Verified from code or configuration.", ["Entry point", "Exposure", "Controls", "Status"])], merged_into="threat-model")
D("secrets", "security", "Secrets", "Secret names, storage, access, and rotation, never values.", "secrets", [
    ("Secret inventory", "Names only. Use YOUR_API_KEY_HERE style placeholders.", ["Name", "Storage", "Access", "Rotation", "Status"]),
    ("Rotation procedure", "Steps."), ("Leak response", "Reference incident-response.md.")])
D("security-checklist", "security", "Security Checklist", "Verification checklist per change and release.", "sensitive", [
    ("Per change or pull request", "- [ ] Tick only after the control is verified."),
    ("Before preview deployment", "- [ ] Tick only after verified."),
    ("Before production release", "- [ ] Tick only after verified."),
    ("After security-sensitive changes", "- [ ] Tick only after verified.")])
D("security-review", "security", "Security Review", "Dated security review results.", "review", [
    ("Review log", "Scope, method, result, evidence.", ["Date", "Scope", "Method", "Result"])])
D("critical-security-exposures", "security", "Critical Security Exposures", "Confirmed high-severity exposures and their remediation.", "review", [
    ("Exposures", "Confirmed only.", ["ID", "Finding", "Evidence", "Impact", "Severity", "Mitigation", "Status"])])
D("incident-response", "security", "Incident Response", "Steps for handling security or availability incidents.", "incident", [
    ("Detection and triage", "Signals and severity."), ("Containment", "First actions."),
    ("Communication", "Who is told, when."), ("Recovery and review", "Post-incident record.")])

# ---- operations
D("deployment", "operations", "Deployment", "Hosting, environments, and release process.", "deploy", [
    ("Environments", "Verified from configuration.", ["Environment", "Purpose", "Access", "Status"]),
    ("Release process", "Steps. Production release needs written owner approval (T4)."),
    ("Rollback", "How to revert."), ("Monitoring", "Or link monitoring.md.")])
D("preview-deployment", "operations", "Preview Deployment", "Preview environment process.", "deploy", [
    ("Process", "Prefer folding into deployment.md.")], merged_into="deployment")
D("production-deployment", "operations", "Production Deployment", "Production release process.", "deploy", [
    ("Process", "Prefer folding into deployment.md.")], merged_into="deployment")
D("monitoring", "operations", "Monitoring", "Monitoring, alerting, and operational requirements.", "monitoring", [
    ("Signals", "Metrics, logs, traces.", ["Signal", "Source", "Alert", "Status"]),
    ("Alerting and ownership", "Who responds.")])
D("operations", "operations", "Operations", "Day-to-day operational procedures.", "monitoring", [
    ("Runbook", "Routine procedures.")], merged_into="monitoring")

BY_NAME = {d["name"]: d for d in CATALOG}
READ_ORDER = ["project-intake", "instructions", "status-labels", "prd", "decisions", "current-state",
              "agents", "authorization-matrix", "glossary", "architecture", "technology"]


# ---------------------------------------------------------------- rendering
def header(project, title, purpose, status, today):
    return [f"# Title: {project} {title}", "", purpose, "", f"Status: {status}", f"Last updated: {today}", ""]


def render_doc(doc, project, today):
    out = header(project, doc["title"], doc["purpose"], doc["status"], today)
    if doc["body"]:
        return "\n".join(out + doc["body"]) + "\n"
    for s in doc["sections"]:
        heading, hint = s[0], s[1]
        cols = s[2] if len(s) > 2 else None
        status = s[3] if len(s) > 3 and s[3] else "Open"
        rows = s[4] if len(s) > 4 else None
        out += [f"## {heading}", "", f"**Status: {status}**", "", f"> {hint}", ""]
        if cols:
            out.append("| " + " | ".join(cols) + " |")
            out.append("|" + "|".join("---" for _ in cols) + "|")
            for r in (rows or [["—"] * len(cols)]):
                out.append("| " + " | ".join(r) + " |")
            out.append("")
    return "\n".join(out)


def doc_trigs(doc):
    t = doc["trig"]
    return [t] if isinstance(t, str) else list(t)


def doc_path(doc):
    return pathlib.PurePosixPath("docs") / doc["folder"] / f"{doc['name']}.md"


def resolve(args):
    chosen = set()
    if args.preset:
        chosen |= set(PRESETS.get(args.preset, []))
    if args.triggers:
        chosen |= set(x.strip() for x in args.triggers.split(",") if x.strip())
    if args.preset == "all" or "all" in chosen:
        chosen = set(TRIGGERS)
        standalone_all = True
    else:
        standalone_all = False
    unknown = chosen - set(TRIGGERS)
    if unknown:
        sys.exit(f"Unknown trigger(s): {', '.join(sorted(unknown))}. Run: python scaffold.py list")
    also = set(x.strip() for x in (args.also or "").split(",") if x.strip())
    selected, reasons = [], {}
    for d in CATALOG:
        core = "core" in doc_trigs(d)
        hit = [t for t in doc_trigs(d) if t in chosen]
        if d["merged_into"]:
            if standalone_all or d["name"] in also:
                selected.append(d); reasons[d["name"]] = ("Optional", "Requested standalone")
            else:
                reasons[d["name"]] = ("Consolidated", f"Covered in {d['merged_into']}.md")
        elif core:
            selected.append(d); reasons[d["name"]] = ("Required", "Mandatory core")
        elif hit:
            selected.append(d); reasons[d["name"]] = ("Recommended", f"Trigger: {', '.join(hit)}")
        else:
            reasons[d["name"]] = ("Not needed", f"Trigger absent: {', '.join(doc_trigs(d))}")
    return selected, reasons


def write_if_absent(path, text):
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def selection_log(project, reasons, today):
    out = header(project, "Selection Log",
                 "Records why each candidate document was created, consolidated, or omitted.", "Proposed", today)
    out += ["Generated mechanically from the chosen triggers. **Open**: owner review of every Not needed entry.", "",
            "| Document | Classification | Reason |", "|---|---|---|"]
    for d in CATALOG:
        c, r = reasons[d["name"]]
        out.append(f"| {d['name']}.md | {c} | {r} |")
    return "\n".join(out) + "\n"


def scan_docs(root):
    items = []
    for p in sorted((root / "docs").rglob("*.md")):
        lines = p.read_text(encoding="utf-8").splitlines()
        title = lines[0].replace("# Title: ", "") if lines else p.stem
        purpose = lines[2] if len(lines) > 2 else ""
        status = next((l.split(":", 1)[1].strip() for l in lines[:8] if l.startswith("Status:")), "?")
        items.append((p.relative_to(root).as_posix(), p.stem, title, purpose, status))
    rank = {n: i for i, n in enumerate(READ_ORDER)}
    items.sort(key=lambda x: (rank.get(x[1], 999), x[0]))
    return items


def index_block(root):
    items = scan_docs(root)
    out = [IDX_START, "", "## Documentation Index", "",
           "| # | Document | Purpose | Status |", "|---|---|---|---|"]
    for i, (rel, _stem, title, purpose, status) in enumerate(items, 1):
        out.append(f"| {i} | [{title}]({rel}) | {purpose} | {status} |")
    present = {s for _, s, *_ in items}
    out += ["", "## Consolidation Map", "",
            "| Subject | Documented in |", "|---|---|"]
    any_row = False
    for d in CATALOG:
        if d["merged_into"] and d["name"] not in present and d["merged_into"] in present:
            out.append(f"| {d['name']} | {d['merged_into']}.md |"); any_row = True
    if not any_row:
        out.append("| — | — |")
    out += ["", IDX_END]
    return "\n".join(out)


def readme_text(root, project, today):
    top = header(project, "Documentation", "Entry point and index for the project documentation set.", "Draft", today)
    sections = [
        ("Project Overview", "What the project is, in two sentences. Source: owner."),
        ("Purpose and Scope", "What the documentation covers and what it deliberately does not."),
        ("Documentation Status", "Which documents are Draft, Proposed, or Confirmed. See the index below."),
        ("Recommended Reading Order", "Intake, instructions, PRD, decisions, current state, then conditional documents. See the index order below."),
    ]
    out = top[:]
    for h, hint in sections:
        out += [f"## {h}", "", "**Status: Open**", "", f"> {hint}", ""]
    out += [index_block(root), ""]
    for h, hint in [
        ("Relationships Between Key Documents", "Example: prd.md requirements map to testing.md criteria; decisions.md governs technology.md."),
        ("Current Project Stage", "Mirror current-state.md; do not duplicate."),
        ("Open Questions", "Link to the authoritative list in prd.md or decisions.md."),
        ("Critical Blockers", "Link to current-state.md."),
        ("Next Recommended Actions", "Ordered and concrete."),
    ]:
        out += [f"## {h}", "", "**Status: Open**", "", f"> {hint}", ""]
    return "\n".join(out)


def refresh_readme(root, today):
    p = root / "README.md"
    if not p.exists():
        sys.exit("README.md not found. Run init first.")
    text = p.read_text(encoding="utf-8")
    if IDX_START not in text or IDX_END not in text:
        sys.exit("README.md has no INDEX markers; cannot refresh safely.")
    pre, rest = text.split(IDX_START, 1)
    _, post = rest.split(IDX_END, 1)
    pre = re.sub(r"Last updated: \d{4}-\d{2}-\d{2}", f"Last updated: {today}", pre, count=1)
    p.write_text(pre + index_block(root) + post, encoding="utf-8")


# ---------------------------------------------------------------- commands
def cmd_list(_a):
    print("TRIGGERS (use with --triggers a,b,c)")
    for k, v in TRIGGERS.items():
        docs = [d["name"] for d in CATALOG if k in doc_trigs(d)]
        print(f"  {k:<13} {v}\n  {'':<13} -> {', '.join(docs)}")
    print("\nPRESETS: " + ", ".join(f"{k} ({len(v)} triggers)" for k, v in PRESETS.items()) + ", all (every doc standalone)")


def cmd_init(a):
    root = pathlib.Path(a.out).resolve()
    today = a.date or datetime.date.today().isoformat()
    selected, reasons = resolve(a)
    created = []
    for d in selected:
        if write_if_absent(root / doc_path(d), render_doc(d, a.name, today)):
            created.append(str(doc_path(d)))
    if write_if_absent(root / "docs/core/selection-log.md", selection_log(a.name, reasons, today)):
        created.append("docs/core/selection-log.md")
    if root != KIT:
        for name in ("CLAUDE.md", "scaffold.py"):
            if (KIT / name).exists():
                write_if_absent(root / name, (KIT / name).read_text(encoding="utf-8"))
        if (KIT / ".claude").exists() and not (root / ".claude").exists():
            shutil.copytree(KIT / ".claude", root / ".claude")
    if write_if_absent(root / "README.md", readme_text(root, a.name, today)):  # README last
        created.append("README.md")
    else:
        refresh_readme(root, today)
    print(f"Created {len(created)} file(s) in {root}")
    for c in created:
        print("  +", c)
    print("Next: fill docs/core/project-intake.md, then run: python scaffold.py validate")


def cmd_readme(a):
    refresh_readme(pathlib.Path(a.out).resolve(), a.date or datetime.date.today().isoformat())
    print("README index refreshed.")


LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\)")
HARD_SECRETS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    re.compile(r"\b(?:sk|pk)-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bghp_[A-Za-z0-9]{30,}"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
]
SOFT_SECRET = re.compile(
    r"(?i)\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['\"]?"
    r"(?!YOUR_|<|\{\{|\.\.\.|\*{3}|placeholder|example|changeme)[^\s'\"|]{8,}")


def cmd_validate(a):
    root = pathlib.Path(a.out).resolve()
    errors, warns = [], []
    files = [p for p in (root / "README.md", root / "CLAUDE.md") if p.exists()]
    files += sorted((root / "docs").rglob("*.md")) if (root / "docs").exists() else []
    if not (root / "README.md").exists():
        errors.append("README.md missing")
    readme = (root / "README.md").read_text(encoding="utf-8") if (root / "README.md").exists() else ""
    for p in files:
        rel = p.relative_to(root).as_posix()
        text = p.read_text(encoding="utf-8")
        lines = text.splitlines()
        if not lines or not lines[0].startswith("# Title: "):
            errors.append(f"{rel}: line 1 must start with '# Title: '")
        if len(lines) < 3 or lines[1] != "" or not lines[2].strip() or lines[2].startswith("#"):
            errors.append(f"{rel}: line 3 must be a one-line purpose after a blank line")
        st = next((l for l in lines[:10] if l.startswith("Status:")), None)
        if not st or st.split(":", 1)[1].strip() not in STATUSES:
            errors.append(f"{rel}: header Status must be one of {', '.join(STATUSES)}")
        if not any(re.fullmatch(r"Last updated: \d{4}-\d{2}-\d{2}", l) for l in lines[:10]):
            errors.append(f"{rel}: header needs 'Last updated: YYYY-MM-DD'")
        if st and "Confirmed" in st and "**Status: Open**" in text:
            warns.append(f"{rel}: document marked Confirmed but contains Open sections")
        for m in LINK_RE.finditer(text):
            tgt = m.group(1)
            if re.match(r"^(https?:|mailto:)", tgt):
                continue
            if not (p.parent / tgt).resolve().exists():
                errors.append(f"{rel}: broken link -> {tgt}")
        for rx in HARD_SECRETS:
            if rx.search(text):
                errors.append(f"{rel}: possible real secret matches {rx.pattern[:28]}...")
        if SOFT_SECRET.search(text):
            warns.append(f"{rel}: text looks like a credential assignment; confirm it is a placeholder")
        if rel.startswith("docs/") and rel not in readme:
            errors.append(f"{rel}: not indexed in README.md")
    rp = root / "README.md"
    if rp.exists():
        newer = [p.relative_to(root).as_posix() for p in (root / "docs").rglob("*.md")
                 if p.stat().st_mtime > rp.stat().st_mtime + 1] if (root / "docs").exists() else []
        if newer:
            warns.append(f"README.md older than {len(newer)} doc(s); run 'readme' to refresh (README is updated last)")
    for w in warns:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    print(f"\n{len(files)} file(s) checked: {len(errors)} error(s), {len(warns)} warning(s).")
    print("Not checked by this tool: factual accuracy, diagram correctness, design-reference review, whether Confirmed claims have real evidence.")
    sys.exit(1 if errors else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    i = sub.add_parser("init")
    i.add_argument("--name", default="Project Name")
    i.add_argument("--out", default=".")
    i.add_argument("--preset", choices=list(PRESETS) + ["all"])
    i.add_argument("--triggers", help="comma-separated trigger flags")
    i.add_argument("--also", help="comma-separated consolidated docs to generate standalone")
    i.add_argument("--date")
    i.set_defaults(fn=cmd_init)
    for n, fn in (("readme", cmd_readme), ("validate", cmd_validate)):
        s = sub.add_parser(n)
        s.add_argument("--out", default=".")
        s.add_argument("--date")
        s.set_defaults(fn=fn)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
