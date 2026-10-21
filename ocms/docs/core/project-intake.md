# Title: OCMS Project Intake

Captures the facts and needs that drive documentation selection.

Status: Draft
Last updated: 2026-10-20

## Project name and purpose

**Status: Confirmed**

OCMS (Online Complaint Management System) — a web application that lets citizens file grievance complaints, lets officers and administrators manage, assign, escalate, and resolve those complaints, and provides audit logging and reporting. Source: `package.json` description and `server.js`/`routes.js`.

## Target users and their needs

**Status: Confirmed**

Three roles (verified in `models.js` `role` enum and `auth.js` `requireRole`):
- **Citizen**: file complaints, view own complaints/dashboard, upload attachments, give feedback, close resolved tickets.
- **Officer**: view department queue, change complaint status, add updates/comments, manage tags.
- **Admin**: full CRUD over categories/departments/wards/FAQs/announcements/SLA rules/users, assign complaints, escalate, delete complaints, view audit logs.

Source: `models.js:15` (role enum), `routes.js` route guards.

## Main features and intended outcomes

**Status: Confirmed** (implemented) / **Proposed** (not yet implemented)

Implemented (verified in `routes.js`):
- Citizen registration/login with email-or-phonenumber lookup (`$or`), scrypt password hashing, HTTP-only session cookies (`ocms_sid`, 7-day TTL, TTL index auto-expiry).
- Public complaint search with full-text search (`$text`), category/department/priority/status/tag/date-range filters, pagination.
- Complaint creation with SLA due date derived from `sla_rules`, atomic ticket number generation (`OCMS-YYYY-NNNNN` via `$inc` counter), category/department totalFiled increment, staff + admin notifications.
- Complaint detail, comments/updates, tag management (`$addToSet`/`$pull`), attachment upload/download (base64 stored in MongoDB, ~512 KB guard), citizen feedback (1–5 rating, unique index guard), citizen close (Resolved → Closed).
- Officer queue (department open tickets + assigned tickets, `$or`/`$and`/`$in`), status changes with embedded resolution note, reassignment history.
- Admin management CRUD for categories/departments/wards/FAQs/announcements/SLA rules/users, complaint assign/escalate/delete, audit logs, notifications, app settings.
- Reports: 5 aggregation pipelines (department performance, monthly trend, status×priority matrix, top tags, citizen satisfaction) plus KPI side counts.

Not yet implemented (no evidence in repo):
- Email/SMS notification delivery (notifications are stored in MongoDB only).
- File storage outside MongoDB (attachments are base64-in-DB).
- Password reset flow.
- Scheduled tasks / cron jobs.
- Background job queue.

## Current implementation and development stage

**Status: Confirmed**

In build / feature-complete for the assignment. All route handlers, models, auth, and views wiring exist in `server.js`, `auth.js`, `models.js`, `routes.js`. No `views/` or `public/` directory present in the repository snapshot (EJS templates referenced but not inspected). No tests, no CI config, no deployment config. Source: directory listing of `ocms/`.

## Technologies and frameworks

**Status: Confirmed**

| Technology | Version | Purpose | Source |
|---|---|---|---|
| Node.js runtime | not pinned | application runtime | `package.json` |
| Express | 5.1.0 | web framework, routing, views | `package.json:13` |
| Mongoose | 8.19.0 | MongoDB ODM, schemas, indexes | `package.json:14` |
| EJS | 3.1.10 | server-side rendering | `package.json:12` |
| MongoDB | not pinned | persistent data store | `server.js:11` default URI |
| Node crypto (built-in) | n/a | scrypt password hashing, session tokens | `auth.js` |

No `package.json` scripts for `test` or `lint`; only `start`, `seed`, `smoke` (seed/smoke scripts reference missing `seed.js`/`smoke.js`).

## Data collected, generated, stored, or transmitted

**Status: Confirmed** (classes) / **Open** (retention policy)

Data classes stored in MongoDB (20 collections, `models.js`):
- User (name, email, phone, passwordHash, passwordSalt, role, stats, createdAt)
- Session (token, userId, role, expiresAt, TTL index)
- Citizen (userId, embedded address {street, city, pincode, wardId}, savedFilter)
- Officer (userId, departmentId, designation, openCases)
- Department (name, code, head, email, categories)
- Ward (name, code, city, population)
- Category (name, code, description, icon, active, totalFiled, departmentId)
- SlaRule (categoryCode, priority, maxDays)
- Complaint (ticketNo, title, description, citizenId, categoryCode, departmentId, wardId, status, priority, tags[], assignedOfficerId, createdAt, dueAt, resolvedAt, resolution embedded, duplicateOf)
- Update (complaintId, authorId, authorName, kind, text, oldStatus, newStatus)
- Attachment (complaintId, uploadedBy, name, mime, size, dataB64 select:false)
- Assignment (complaintId, officerId, byAdminId, note, reassigned, assignedAt)
- Escalation (complaintId, raisedBy, reason, oldPriority, newPriority, resolved)
- Feedback (complaintId, userId, rating 1–5, comment)
- Notification (userId, title, body, link, read)
- Faq (question, answer, categoryCode, order, active)
- Announcement (title, body, audience, postedBy, active, postedAt)
- AuditLog (actorId, actorName, action, entity, entityId, meta)
- Setting (key, value, updatedAt)
- Counter (key, value) — ticket number counter

Sensitive data classes: password hash/salt, session tokens, citizen address, complaint content, audit logs. No production records exposed.

## User roles and permissions

**Status: Confirmed**

| Role | Permissions | Source |
|---|---|---|
| citizen | file complaints, own dashboard/profile, own feedback, close own resolved tickets, upload attachments on own complaints | `routes.js` guards `requireRole('citizen')`, `requireAuth` |
| officer | queue, status changes, comments, tag management on department/assigned tickets | `requireRole('officer','admin')` |
| admin | all admin CRUD, assign, escalate, delete complaints, users, audit, settings | `requireRole('admin')` |

Session auth: HTTP-only cookie `ocms_sid`, 7-day TTL, scrypt password verification with timing-safe compare. Unauthenticated users redirected to `/login`; unauthorized roles get 403.

## External integrations

**Status: Open**

None evident in source code. Notifications are persisted to MongoDB only (no email/SMS provider). No third-party SDKs beyond Express/Mongoose/EJS. Mark Open pending owner confirmation.

## Security and privacy requirements

**Status: Proposed**

- Password hashing: scrypt with 16-byte salt, 64-byte key, timing-safe comparison (`auth.js:11-19`).
- Session cookies: `httpOnly`, `sameSite: lax`, 7-day maxAge, TTL index auto-expiry (`auth.js:29-35`, `models.js:29`).
- Input sanitization: `clean()` strips leading `$` to prevent operator injection (`routes.js:18`).
- Authorization: role-based route guards (`auth.js:55-67`).
- Ownership checks: citizens access only their own complaints (`routes.js:277-279`).
- Sensitive fields: `dataB64` has `select: false` (`models.js:140`).
- Audit logging on create/update/delete/assign/escalate/login/register (`auth.js:75-80`, called throughout `routes.js`).

Privacy/legal requirements (retention, data subject rights, breach notification) not documented in repo — **Open**, pending owner confirmation.

## Existing documentation and conventions

**Status: Confirmed**

No pre-existing project documentation in `ocms/`. This doc set was generated by `scaffold.py` (v3.0) from the `brain/` starter kit. Code conventions: CommonJS (`require`/`module.exports`), `'use strict'`, 2-space indent, route handlers in `routes.js`, models in `models.js`, auth helpers in `auth.js`, app bootstrap in `server.js`. MongoDB features tagged with `★` comments in `routes.js`.

## Deployment and operational requirements

**Status: Open**

No deployment config, CI/CD, environment variables documented beyond `MONGO_URI` default and `PORT` default in `server.js:10-11`. No `Procfile`, Dockerfile, or cloud config present. **Open**, pending owner confirmation.

## Trigger checklist

**Status: Confirmed**

| Characteristic | Present? | Flag |
|---|---|---|
| Screens or user interfaces | Yes | ui |
| Large UI needing a standalone design philosophy and UI architecture | No | ui-deep |
| Multiple user roles | Yes | roles |
| User-facing text or generated content | Yes | content |
| Specific file or content formats the project reads or writes | No | contentfmt |
| Safety-critical or special-behavior controls | No | controls |
| Time-boxed demo or deliverable | No | demo |
| Components and architectural boundaries | Yes | arch |
| Selected technologies or external services | Yes | tech |
| Required directory layout | Yes | layout |
| Defined coding conventions | Yes | style |
| Database or persistent data store | Yes | db |
| API or service interface | Yes | api |
| Queued or asynchronous work | No | jobs |
| Scheduled tasks | No | schedule |
| Local developer setup | Yes | devsetup |
| Automated testing or QA | No | testing |
| Pull-request workflow | No | pr |
| Hosting, environments, or releases | No | deploy |
| Multi-stage implementation plan | No | plan |
| Personal, confidential, or sensitive data | Yes | sensitive |
| Login, roles, permissions, or sessions | Yes | auth |
| Secret keys, tokens, or credentials | Yes | secrets |
| Meaningful ongoing incident risk | No | incident |
| Significant architectural alternatives | No | alternatives |
| Complex application flows | Yes | flows |
| Monitoring and operational requirements | No | monitoring |
| Distinct security-sensitive data flows | No | dataflow |
| Significant unresolved defects | No | defects |
| Formal security review or exposure tracking | No | review |
| Multi-release product direction | No | roadmap |
| Open product or technical research | No | research |
