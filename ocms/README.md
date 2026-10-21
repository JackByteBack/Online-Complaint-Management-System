# OCMS — Online Complaint Management System

A city-service grievance portal: citizens file complaints (roads, water, waste, power…), staff route and resolve them, administrators manage master data, all with SLA deadlines, full-text search, and MongoDB aggregation reports.

**Stack:** Node.js · Express 5 · Mongoose · EJS (server-rendered, no build step) · MongoDB 8.3

## Run it

```bash
# 1. MongoDB — either cloud (Atlas) or local.
#    Atlas: create a free cluster, whitelist your IP, then put the connection string
#    in `.env` (see `.env.example`). Atlas's default IP whitelist (45.115.53.61) works from college/home.
#    Local: skip `.env` and run your own mongod:
mongod --dbpath .mongodbdata --port 27017 --logpath .mongodbdata/mongod.log &

# 2. install + seed + start
npm install
npm run seed        # wipes & reseeds demo data into db "ocms"
npm start           # → http://localhost:3000

# 3. verify everything end-to-end
npm run smoke       # needs the server running
```

> **Atlas note:** the first connection takes a few seconds; `seed.js` drops the `ocms` database on the target cluster before reseeding — point `MONGO_URI` at a throwaway database name if you care about the cluster's other data.

### Seeded demo logins

| Role    | Login            | Password   |
|---------|------------------|------------|
| Admin   | admin@ocms.test  | Admin@12345|
| Officer | road@ocms.test · water@ocms.test · waste@ocms.test · power@ocms.test | Officer@123 |
| Citizen | ravi@proton.test · sneha@proton.test · iqbal@proton.test · meera@proton.test · deelip@proton.test | Citizen@123 |

(numbered demo passwords are seed data only; real deployments must rotate them)

## The 20 MongoDB collections

| # | Collection | Purpose |
|---|-----------|---------|
| 1 | `users` | accounts (citizen / officer / admin), scrypt password hashes, stats |
| 2 | `sessions` | login sessions (cookie → token), TTL auto-expiry |
| 3 | `citizens` | citizen profiles with **embedded address document** |
| 4 | `officers` | staff profiles → department linkage, open-case counters |
| 5 | `departments` | city departments + category codes they handle |
| 6 | `wards` | city zones |
| 7 | `categories` | complaint categories (with totalFiled counters) |
| 8 | `slarules` | resolution window per category × priority |
| 9 | `complaints` | the main document (tags array, embedded resolution doc, dueAt) |
| 10 | `updates` | ticket timeline comments / status changes |
| 11 | `attachments` | uploaded files stored in MongoDB (base64, ≤512 KB) |
| 12 | `assignments` | assignment/reassignment history documents |
| 13 | `escalations` | escalation records (priority bumps) |
| 14 | `feedbacks` | citizen ratings of resolutions |
| 15 | `notifications` | per-user inbox |
| 16 | `faqs` | public FAQ entries |
| 17 | `announcements` | portal notices (audience-scoped) |
| 18 | `auditlogs` | actor/action/entity records for every mutation |
| 19 | `settings` | key/value app settings |
| 20 | `counters` | atomic ticket-number generator |

## Requirement → code map

| Assignment requirement | Where |
|------------------------|-------|
| CRUD operations | Complaints: create/detail/update-comment/status/delete (`routes.js` → `complaintCreate`, `addUpdate`, `changeStatus`, `deleteComplaint`); Categories/Departments/Wards/FAQs/Announcements: full CRUD in `adminManage` routes; Feedback: create+read |
| Logical filtering | `$or` (login email-or-phone, officer queue dept-or-assigned), `$and` (search overdue flag, admin SLA-breach KPI), user search `$or` + regex |
| Comparison filtering | `$in` (status/priority multi-select), `$gte`/`$lte` (date-range search, monthly counters), `$lt` (SLA `dueAt` breach), `$ne` / `$exists` (uniqueness checks), `$gt` (delete guards) |
| Projection + limit | every list uses `.select(...)` + `.limit(N)` — home, dashboard, queue, search (paginated skip/limit), notifications, audit log |
| Array handling | `complaint.tags` via `$addToSet`/`$pull`/`$all`; `$unwind`+`$group` tag pipeline |
| Document handling | embedded `address` sub-doc in citizens, embedded `resolution` doc in complaints, `$lookup`+`$unwind` in pipeline 1, `$inc` counters, atomic `$findOneAndUpdate` ticket generator |
| Aggregation pipelines | `reports()` in `routes.js`: ① department performance ($match→$group avg days→$sort→$lookup→$unwind→$project), ② monthly trend ($match range→$group by $dateToString→$project→$sort→$limit), ③ status×priority matrix ($match→$group composite key→$sort→$project), plus bonus ④ top tags ($unwind→$group→$sort→$limit) and ⑤ avg rating |
| `$match` `$group` `$sort` `$project` | all five pipelines above; plus citizen dashboard status-count mini-pipeline |
| Indexes | **text index** `title_text_description_text_tags_text`; compound `{status, createdAt}`; compound unique `{categoryCode, priority}` on sla_rules; TTL on `sessions.expiresAt`; unique on `users.email`, `tickets`, `sessions.token`; per-model auto indexes on every FK. Rebuilt by `seed.js` / `syncIndexes()` on boot |
| Text search | `/search?q=…` uses `$text: { $search }` + `$meta` score ranking (models.js text index) |
| Search / filter / report section | `/search` (7-way filter form + pagination), `/reports` (5 pipelines, KPI cards), `/audit` log viewer, admin SLA-breach watchlist |

## Project files

```
ocms/
├── server.js        # express bootstrap, cookie parsing, DB connect + syncIndexes
├── routes.js        # every route ($-features tagged with ★ comments)
├── auth.js          # scrypt hashing, session middleware, roles, audit/notify helpers
├── models.js        # the 20 Mongoose schemas + all indexes
├── seed.js          # wipes and reseeds realistic demo data (34 complaints, 6 months)
├── smoke.js         # end-to-end HTTP test (14 steps, exits non-zero on failure)
├── spotcheck.js     # admin-flow checks (assign/escalate/settings/wards/SLA)
├── screenshot.js    # captures all 19 demo pages into screenshots/ via headless Chrome
├── screenshots/     # PNG screenshots of every key page (public, citizen, officer, admin)
├── report/          # assignment deliverable: charts (SVG+PNG from live pipelines), REPORT.md, code copies
├── views/           # 17 EJS pages + 2 partials
└── public/style.css # single stylesheet, no framework
```

## Security notes (demo scope, deliberate simplifications)

- scrypt password hashing + timing-safe compare; httpOnly sameSite cookie sessions stored server-side.
- No CSRF tokens, no rate limiting — acceptable for the assignment; add before any real deployment.
- Attachments capped at ~512 KB and stored inline in MongoDB (no GridFS needed at this scale) — ponytail: move to GridFS/S3 when files get bigger.
- `seed.js` drops the database — dev tool, never run it against a real one.
