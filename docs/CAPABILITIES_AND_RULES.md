# PULSE — Complete Capability & Rules Reference (plain English)

Everything the platform can do, who is allowed to do it, and every rule the system enforces automatically. If it is not on this list, the app does not do it.

---

## 1. THE PEOPLE — roles and rights

Every person has **one base role**, plus up to three extra flags.

### ADMIN (the Group IT Manager)
**Can do everything**, and is the only one who can:
- Create, edit, deactivate, and delete user accounts; reset passwords; unlock locked accounts
- Mark a project **Confidential** (or remove the mark)
- Delete anything (projects, milestones, roadblocks, actions) — always a *soft* delete: hidden, never destroyed
- Read the audit trail (the who-changed-what history)
- Give or remove the **Steering Committee** and **Enterprise access** flags
- Force a RAG recompute of all projects

### DIVISION LEAD (head of one of the 7 IT divisions)
- Can create new projects
- Has **full control** of any project where their division is the LEAD
- On projects where their division is only ENGAGED or CONSULTED: can create/edit milestones, roadblocks, and actions **owned by their own division or their own people**, and post status updates — but **cannot** change the project's own fields (title, dates, PM, stage…)
- Can create and run meetings
- Can see everything, including confidential projects
- **Cannot**: manage users, set the confidential flag, delete anything

### CONTRIBUTOR (site IT leads, engineers)
- Can see all non-confidential projects (unless site-restricted — see flags)
- On projects that touch **their division or their site**: can add actions, raise roadblocks, and post status updates
- Can edit and complete **items assigned to them** (their own actions, milestones, roadblocks)
- Can tick readiness checklists for their own site
- **Cannot**: create projects, create milestones, edit project fields, create meetings, see confidential projects, delete anything

### VIEWER (CIO, stakeholders)
- Can read everything non-confidential, search, use every dashboard, and export decks and Excel files
- **Cannot write anything, ever** — no projects, no actions, no updates, no meetings, nothing. This is enforced by the server and proven by automated tests
- Can never be made a project manager

### The three extra flags (independent of role)

**Project Manager (per-project assignment, not a role).** Any non-Viewer — including a plain Contributor — can be named PM of a project. The PM gets **full control of that one project**: its fields, milestones, roadblocks, actions, updates, decisions, deliverables, commentary, and its deck. Everywhere else, their normal role still applies. A site technician can therefore drive their own project end-to-end without gaining any group-wide power.

**Steering Committee (yes/no, set by Admin).** Only people with this flag can approve the PLANNING → EXECUTION stage gate. Even an Admin or a full-rights Division Lead is refused at this gate without the flag.

**Enterprise access (yes/no, set by Admin; default yes).** If switched off, the person sees **only projects touching their own site** — in the portfolio, search, reports, War Room, everywhere. Other sites' projects look as if they don't exist. Being PM of a project always keeps that project visible.

---

## 2. WHAT YOU CAN DO — full capability list

### Accounts & sign-in
- Sign in with email + password; sign out; change your own password (minimum 10 characters)
- Stay signed in through server restarts (sessions live in the database)

### Projects
- Create a project (Admin/Division Lead): it automatically gets a unique code like `PRJ-2026-001`
- Set title, description, sponsor, priority (P1/P2/P3), start/target/end dates, budget note, roadmap pillar
- Attach divisions with a role each (LEAD / ENGAGED / CONSULTED) and any number of sites
- Assign or change the Project Manager (the person is notified)
- Move the project through its lifecycle stages — through the gates (see §3)
- Write the **executive commentary** (“what the CFO/CIO must understand this month”) — it goes into decks word for word
- Override the computed RAG color — only with a written reason of at least 30 characters; the override is permanently badged “MANUAL”

### Milestones & progress
- Add milestones with a type: STANDARD, SECURITY_GATE, SITE_READINESS, UAT, or GO_LIVE
- Give each an owner, an Infra↔Ops co-owner, a site, and a due date
- Mark them in progress, done, or slipped
- SITE_READINESS milestones automatically come with a 6-item checklist (power, rack space, LAN, local hands, access badge, change window) that site staff can tick
- **Progress is always calculated** — % of milestones done. Nobody can type a percentage

### Roadblocks
- Raise a roadblock with a severity (CRITICAL / MAJOR / MINOR), owner, and due date
- Resolve it with a note, or **escalate** it — one click that alerts the Admin and every engaged Division Lead

### Actions
- Quick-add an action (title + owner + due date, press Enter); the owner is notified
- Tick it done in one tap; cancel it (cancelled actions never count anywhere)
- Actions can belong to a project, a meeting, a roadblock, or be general (no project)

### Status updates & decisions
- Post a 20-second update: a mood (ON TRACK / WATCH / AT RISK) plus one sentence (max 400 characters)
- Log decisions with who decided and when, optionally tied to a meeting

### Meetings (the heart of the tool)
- Create a meeting (Admin/Division Lead) — the **agenda writes itself** from six rules: red projects, amber projects, roadblocks new since the last closed meeting of the same type, overdue actions grouped by owner, go-lives within 30 days, and silent projects
- Optionally scope the whole meeting to **one site** — all six rules then look at that site only
- Reorder, remove, or add agenda items; pick attendees; mark who was present
- Go **Live**: a large projection screen steps item by item; the organizer captures **Actions, Decisions, Roadblocks, and Notes** as the meeting happens — each becomes a real, tracked object linked to both the project and the meeting
- **Close** the meeting: minutes are generated instantly (attendees, notes, decisions, actions, a RAG snapshot), printable to PDF and copyable into an email

### Deliverables & RACI
- Define deliverables per project with due dates and a status (pending / in progress / delivered)
- Tag people on each deliverable as **R**esponsible, **A**ccountable, **C**onsulted, or **I**nformed
- A person tagged R or A can progress the deliverable even without full project rights

### Dashboards & views
- **Portfolio Wall**: every active project as a card; filters by division, **site**, stage, RAG, priority, and PM; the KPI banner always recounts for exactly what you filtered
- **Project Room**: one project in full — timeline, roadblocks, actions, updates & decisions, deliverables, RAG breakdown
- **Site Lens**: one site's complete picture — projects, deadlines, readiness checklists, roadblocks, the site team's tasks, upcoming go-lives
- **My Actions**: your own open work sorted by due date, plus cards for **projects you manage**
- **War Room**: the active portfolio with governance phase, the next stage gate and its live requirement checklist, deliverable progress, your RACI duties, and recent gate approvals
- **Reports**: RAG trend over time, division workload, roadblock aging, action resolution rate, per-site breakdown — every table exports to Excel
- **Search**: find any project or roadblock by name or code from the top bar
- **Notifications**: a bell with your unread alerts

### Exports (one click, zero rework)
- **Group deck**: title, health KPIs with RAG donut, full portfolio table, leadership roadblocks, division snapshot, executive commentary — and it **respects your filters**: filter to one site and you get a site deck with the title adjusted automatically
- **Project deck**: 7 slides including a visual timeline
- **Excel**: any report table
- All exports are in Endeavour corporate style, generated in your browser

### Working offline
- If the network drops, every change you make is **saved locally in your browser** and you are told so
- When the connection returns, your changes are sent to the server **in the exact order you made them**
- If the server refuses one (for example someone changed the same record meanwhile), syncing **stops**, the change is kept frozen, and **every Admin is alerted** — a human decides, never the machine
- After review, you can retry or discard the blocked change from the status chip in the top bar

---

## 3. THE AUTOMATIC RULES — what the system enforces without asking

### The RAG color (Green / Amber / Red) is computed, never declared
Worst of four signals:
1. **Schedule** — milestones slipped or past due: none = Green, up to 20% = Amber, more = Red
2. **Roadblocks** — an open CRITICAL = Red, an open MAJOR = Amber
3. **Overdue actions** — 1–3 = Amber, 4 or more = Red
4. **Freshness** — no status update for 21 days = Amber; **no activity of any kind for 30 days = Red** (a silent project cannot look healthy)

Projects in RUN, CLOSED, or ON_HOLD are excused from the freshness rule. An override needs a 30-character reason and shows a “MANUAL” badge with the real computed color still visible.

### Stage gates cannot be skipped
`IDEA → DESIGN → BUILD → DEPLOY → RUN → CLOSED`, one step at a time (ON_HOLD can park/resume anywhere active). Each gate has fixed conditions:
- **IDEA → DESIGN**: description, sponsor, and target date must be filled
- **DESIGN → BUILD**: at least one milestone must exist **and the approver must be Steering Committee**
- **DEPLOY → RUN**: a GO_LIVE milestone must be done
- **RUN → CLOSED**: an actual end date must be recorded
Every approved transition is written to a permanent ledger: who, when, from-to, and a note.

### No silent overwrites
If two people edit the same thing, the second one is stopped and shown the newer version (“this changed since you loaded it — review and retry”). Last-writer-wins does not exist here.

### Confidentiality is absolute
A confidential project is **invisible** — not greyed out — to Contributors and Viewers, in every list, search, report, meeting agenda, and deck. Only its own PM keeps access. Admins and Division Leads see it.

### Everything is recorded, nothing is truly deleted
Every change is written to the audit trail field by field (old value → new value, by whom, when — never passwords). Deleting only hides; history stays.

### Security guardrails
- 5 wrong passwords = account locked 15 minutes
- First login (and after any admin reset) = you must set your own password before doing anything else
- 10 login attempts per minute per address, maximum; general request limits on the whole API
- All times everywhere are GMT; “overdue” means past GMT midnight

### Notifications fire automatically when:
- You are made PM of a project · an action or milestone is assigned to you · a roadblock is escalated (Admins + engaged Division Leads) · **your project turns RED** (PM + lead Division Lead) · a meeting is scheduled with your project on the agenda · a user's offline sync halts (all Admins)

---

## 4. THE PROCESSES MANAGED END-TO-END

1. **Project lifecycle** — proposal → gated approvals → execution → closure, with an approval ledger
2. **Progress & health tracking** — computed progress, computed RAG, recalculated after every single change
3. **Weekly coordination meeting** — auto-agenda → live capture → instant minutes → next agenda knows what's new
4. **Roadblock management** — raise → own → resolve or escalate to leadership
5. **Action tracking** — assign → notify → chase overdue → done
6. **Site readiness** — standard 6-point checklist per site go-live
7. **Deliverable accountability** — RACI matrix per deliverable
8. **Executive reporting** — one-click branded decks and Excel, always current
9. **User & access administration** — roles, flags, lockouts, forced password changes
10. **History & compliance** — full audit trail, gate ledger, soft deletes
11. **Data safety** — automatic nightly verified backups, 14-day retention, weekly trend snapshots, rehearsed restore
12. **Offline continuity** — local queue, ordered replay, human-decided conflicts

---

## 5. WHAT YOU CANNOT DO — the explicit refusals

- Type a progress percentage or pick your own RAG color without a justified, badged override
- Skip a lifecycle stage, or pass the PLANNING → EXECUTION gate without a Steering Committee approver
- Write anything as a Viewer, or make a Viewer a project manager
- See a confidential project (or find it in search/decks) below Division Lead — unless you are its PM
- See other sites' projects if your account is site-restricted
- Overwrite someone else's simultaneous edit
- Hard-delete anything, or delete at all unless you are Admin
- Edit closed-meeting minutes directly (change the underlying items and re-close — minutes are a snapshot, not a document)
- Escalate an already-resolved roadblock
- Log in past the rate limit or while locked out; use the app before setting your own password
- Have the machine auto-resolve an offline sync conflict — a halted queue always waits for a human

### Not in this version (planned, not present)
Email/Teams notifications (bell only) · Entra ID single sign-on (local passwords for now) · live multi-screen meeting sync (one driver, others refresh) · file attachments · Gantt dependencies · budget tracking · French interface.
