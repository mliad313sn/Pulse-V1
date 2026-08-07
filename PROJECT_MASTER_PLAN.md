# Enterprise Project & Portfolio Management Platform
## Master Product Scope, Architecture, Delivery Plan, Acceptance Criteria & Test Specification

**Status:** Authoritative implementation specification  
**Purpose:** Allow an autonomous engineering orchestrator to build the complete platform from scratch to release-ready completion without requiring product decomposition or day-to-day development decisions from the user.  
**Companion orchestrator:** `.claude/skills/goal/SKILL.md` invoked as `/goal`  
**Canonical time:** UTC  
**Working product name:** Enterprise PPM Platform (the repository/product may use its established name)

---

# 0. DOCUMENT CONTRACT

This file is simultaneously:

- product requirements document;
- functional specification;
- governance specification;
- security/access specification;
- architecture baseline;
- delivery roadmap;
- engineering quality contract;
- test plan;
- acceptance plan;
- release definition.

The implementation is successful only when the executable application, tests and operational assets satisfy this document.

When implementation details are not explicitly specified, engineering may choose sensible enterprise defaults provided they do not weaken:

- authorization;
- confidentiality;
- auditability;
- data integrity;
- usability;
- reliability;
- traceability;
- maintainability;
- testability.

---

# 1. PRODUCT VISION

Build a complete enterprise **Project & Portfolio Management Operating System** that becomes the authoritative environment for:

```text
Strategy
→ Portfolio
→ Program
→ Project
→ Workstream
→ Task / Milestone
→ Action
→ Risk / Roadblock / CAPA
→ Deliverable / RACI
→ Decision / Meeting
→ Deployment / Site Readiness
→ Operational Handover
→ Benefit
→ Closure
```

The platform replaces fragmented management through:

- spreadsheets;
- PowerPoint;
- email action lists;
- disconnected meeting notes;
- manually calculated status;
- isolated site trackers;
- static governance checklists;
- untraceable decisions.

The central rule is:

> Enter operational truth once; derive management information everywhere.

A milestone completion changes progress.  
A roadblock changes health.  
An action changes accountability.  
A project update changes freshness.  
A decision changes governance history.  
A resource assignment changes capacity.  
A financial update changes variance.  
A gate approval changes lifecycle.  
The same underlying records feed dashboards, meetings, reports and exports.

There must never be a parallel reporting reality.

---

# 2. PRIMARY PRODUCT OUTCOMES

The finished system must make these statements true.

## Project Manager
“I update the project once and every dashboard, meeting, report and presentation is current.”

## Contributor
“I open My Work and immediately know what I own, what is due and what is blocked.”

## Site Lead
“I can see the complete project world affecting my site without searching several trackers.”

## Division Lead
“I can identify which projects, milestones, resources, roadblocks and decisions require intervention.”

## CIO / Executive
“I see portfolio health, trend, go-lives and required decisions, and can drill into an exception live.”

## Steering Committee
“Every gate decision is based on visible evidence and permanently recorded.”

## Auditor
“I can reconstruct who changed what, when, why and under what authority.”

## Administrator
“Identity, organization, access, governance rules and operational controls are centrally manageable.”

---

# 3. DESIGN PRINCIPLES

## 3.1 Single source of truth
One data entry feeds all authorized views and outputs.

## 3.2 Governance by design
Important governance rules are server-enforced, not procedural suggestions.

## 3.3 Management by exception
Red/amber conditions, due work, roadblocks, gate blockers and capacity conflicts surface automatically.

## 3.4 Minimal administration
The product should calculate, aggregate, remind, compile and distribute automatically where deterministic rules exist.

## 3.5 Visible accountability
Meaningful work has an owner/accountable party and due/decision context.

## 3.6 Explainable automation
RAG, progress, overload, variance and other derived metrics explain their source.

## 3.7 Security is data-level
The absence of a UI button is not authorization.

## 3.8 No silent loss
Conflicts, retries and concurrent edits must preserve or explicitly reject information, never silently discard it.

## 3.9 Accessible enterprise UX
Fast, responsive, keyboard-friendly, readable, and usable during projected meetings.

---

# 4. ORGANIZATION MODEL

Support a multi-tier structure:

```text
GROUP
 ├─ BRANCH / SITE
 │   ├─ DIVISION / DEPARTMENT
 │   │   ├─ SERVICE / TEAM
 │   │   │   └─ USER
```

The application must also support centralized divisions whose members work across several sites.

Core entities:

- Organization/Group
- Site/Branch
- Division/Department
- Service/Team
- User
- Organizational membership
- Site assignment
- Division assignment

A user may have multiple organizational memberships where required, but must have a clear primary site/division for default scoping.

---

# 5. IDENTITY AND ACCESS MODEL

Effective permission is calculated from:

1. account state;
2. base role;
3. organizational membership;
4. enterprise/site scope;
5. information classification;
6. project membership;
7. project-specific role;
8. object ownership/responsibility;
9. governance privileges;
10. operation-specific policy.

All meaningful authorization is enforced server-side.

A hard deny beats an allow.

---

# 6. BASE ROLES

Every active user has exactly one base role.

## 6.1 ADMIN

Intended for Group IT platform administrators / Group IT management.

Can:
- create/edit/deactivate/reactivate users;
- reset passwords;
- unlock local accounts;
- manage organization hierarchy;
- grant Steering Committee privilege;
- configure Enterprise Access;
- manage classifications;
- set project confidentiality;
- configure reference data;
- configure portfolios/pillars/templates;
- inspect audit;
- soft-delete;
- restore eligible soft-deleted records;
- administer notification/report policies;
- access system operations screens.

Admin is not automatically a Steering Committee approver.

## 6.2 DIVISION_LEAD

Can:
- create projects;
- fully control projects led by their division, subject to governance gates;
- nominate PM;
- create/run meetings;
- manage their division’s owned milestones/tasks/actions/roadblocks/deliverables on engaged projects;
- post updates;
- view dashboards/reports across authorized enterprise scope;
- view confidential projects according to policy.

Cannot:
- administer users;
- grant Steering privilege;
- change enterprise-scope flags;
- hard-delete;
- alter audit or approval history;
- bypass gates.

## 6.3 CONTRIBUTOR

Typical:
- site IT lead;
- engineer;
- analyst;
- technical specialist;
- coordinator.

Within authorized sites/projects/divisions can:
- create/update assigned tasks;
- create/complete actions;
- raise/manage owned roadblocks;
- update owned CAPA;
- post project updates;
- progress owned deliverables;
- tick site readiness;
- log time.

Cannot normally:
- create project;
- edit core project charter;
- approve governance gate;
- delete;
- manage users;
- set confidentiality.

A Contributor may become PM or Workstream Lead on a project and gain project-scoped capabilities.

## 6.4 VIEWER

Strict server-enforced read-only role.

Can:
- view authorized dashboards/projects;
- use search;
- inspect reports;
- export authorized decks/PDF/Excel.

Cannot:
- create;
- update;
- comment;
- complete;
- assign;
- approve;
- delete;
- become PM;
- become Workstream Lead.

API attempts to write as Viewer must return authorization failure.

---

# 7. PROJECT-SPECIFIC ROLES

Supported project assignments:

- Sponsor
- Project Manager
- Deputy Project Manager
- Workstream Lead
- Contributor
- Subject Matter Expert
- Finance Controller
- Security Reviewer
- Site Lead
- Auditor
- Approver
- Informed Stakeholder

## 7.1 Project Manager
Not a base role.

Any non-Viewer may be assigned.

PM receives full operational control of that project, limited by:
- classification;
- immutable governance history;
- Steering-specific approvals;
- admin-only user/delete/system functions.

## 7.2 Workstream Lead
Can control assigned workstream and its operational objects without gaining full project charter authority.

## 7.3 Finance Controller
Can access/manage project finance according to configured finance policy.

## 7.4 Auditor
Read-only access to authorized project/governance history.

---

# 8. SPECIAL ACCESS MODIFIERS

## 8.1 Steering Committee
Admin-granted independent privilege.

Only an authorized Steering member can approve gates designated as Steering-gated.

An Admin without this privilege is denied.

## 8.2 Enterprise Access
Default ON.

When ON:
- user sees all information allowed by their base/project/classification policies.

When OFF:
- user sees their own site;
- projects explicitly assigned to them;
- projects they manage;
- related meetings/actions/notifications/reports.

Other sites should behave as nonexistent.

Being assigned PM keeps that project visible.

---

# 9. INFORMATION CLASSIFICATION

Implement at least:

```text
INTERNAL
RESTRICTED
CONFIDENTIAL
```

## INTERNAL
Normal authorized enterprise/site visibility.

## RESTRICTED
Requires project membership or explicitly authorized role/scope.

Can be used for:
- financials;
- contracts;
- sensitive bottlenecks;
- selected executive material.

## CONFIDENTIAL
Project-level invisibility for unauthorized users.

Unauthorized users must not receive:
- project name;
- code;
- search result;
- autocomplete;
- dashboard count contribution if it reveals existence;
- agenda item;
- report row;
- export slide;
- notification;
- direct-object access;
- meaningful “forbidden confidential project exists” error.

Project PM remains authorized to their own project unless an even higher explicit security policy is introduced.

---

# 10. PORTFOLIO HIERARCHY

Support:

```text
Strategic Pillar
  → Portfolio
    → Program (optional)
      → Project
        → Workstream
```

Projects may belong directly to Portfolio.

Portfolio fields:
- title;
- owner;
- description;
- strategic pillar;
- objective;
- date horizon;
- participating sites;
- participating divisions;
- aggregate health;
- financial summary;
- benefit summary.

Program fields:
- title;
- owner;
- portfolio;
- objective;
- date horizon;
- participating entities;
- aggregate health.

---

# 11. PROJECT CREATION

Generate immutable human-readable project code such as:

```text
PRJ-2026-001
```

Use transaction-safe sequence generation.

Project fields include:
- code;
- title;
- short title;
- description;
- business problem/opportunity;
- desired outcome;
- scope;
- out of scope;
- Sponsor;
- PM;
- pillar;
- portfolio;
- program;
- category;
- priority;
- start date;
- target date;
- actual end date;
- sites;
- lead division;
- engaged divisions;
- consulted divisions;
- expected benefits;
- budget currency/baseline where used;
- information classification;
- executive commentary;
- operational status;
- lifecycle stage;
- version.

---

# 12. LIFECYCLE AND STATUS

Separate governance lifecycle from operating status.

## 12.1 Lifecycle

```text
IDEA
→ INITIATION
→ PLANNING
→ EXECUTION
→ DEPLOYMENT
→ RUN
→ CLOSED
```

No skips.

## 12.2 Operating status

```text
NOT_STARTED
IN_PROGRESS
ON_HOLD
COMPLETED
CANCELLED
```

`ON_HOLD` parks the project without destroying lifecycle history.

`CANCELLED` is a controlled terminal state with:
- reason;
- approver if policy requires;
- date;
- disposition of outstanding work.

---

# 13. GATE ENGINE

Gate definitions and requirements should be data-driven/configurable while retaining protected core requirements.

Each gate evaluation produces:
- satisfied requirements;
- missing requirements;
- warnings;
- evidence;
- requested by;
- approver requirement;
- decision.

## Gate 0 — IDEA → INITIATION
Required:
- title;
- problem/opportunity;
- Sponsor;
- preliminary owner;
- target objective;
- strategic pillar.

## Gate 1 — INITIATION → PLANNING
Required:
- description;
- scope;
- Sponsor;
- PM;
- target date;
- sites;
- divisions;
- initial risks;
- expected outcome.

## Gate 2 — PLANNING → EXECUTION
Required:
- project plan;
- at least one milestone;
- RACI;
- initial risk register;
- deliverables;
- project team;
- baseline dates;
- resource plan;
- budget baseline if financial tracking enabled;
- acceptance criteria.

Requires Steering Committee approver.

## Gate 3 — EXECUTION → DEPLOYMENT
Conditional requirements according to project type:
- delivery scope complete enough;
- deployment plan;
- implementation/change plan;
- rollback plan where relevant;
- operational readiness;
- security readiness;
- UAT;
- unresolved roadblock review;
- support model;
- communications.

## Gate 4 — DEPLOYMENT → RUN
Required:
- GO_LIVE milestone done;
- implementation record;
- acceptance;
- support owner;
- operational handover;
- critical post-go-live issues documented;
- residual risks accepted.

## Gate 5 — RUN → CLOSED
Required:
- actual end date;
- closure summary;
- outstanding actions dispositioned;
- lessons learned;
- deliverables accepted;
- required documentation;
- benefits owner;
- financial closure if used.

---

# 14. APPROVAL LEDGER

Immutable logical record:

- project;
- gate;
- project version/baseline;
- request timestamp;
- requester;
- approver;
- approver authority type;
- decision;
- decision timestamp;
- note;
- evidence references.

Normal application must not expose update/delete operations for approval ledger entries.

---

# 15. PROJECT CHANGE CONTROL AND BASELINES

Material changes require Project Change Request.

Change types:
- Scope
- Schedule
- Budget
- Benefit
- Major Resource
- Cancellation

Capture:
- request;
- rationale;
- impact analysis;
- affected milestones;
- cost impact;
- schedule impact;
- risk impact;
- decision;
- approver.

Retain:
- original baseline;
- each approved baseline;
- current forecast;
- actuals.

Changing forecast does not erase baseline.

---

# 16. PROJECT ROOM

Tabs/sections:

1. Overview
2. Plan / Timeline
3. Workstreams
4. Tasks
5. Milestones
6. Actions
7. Roadblocks
8. Risks
9. CAPA
10. Deliverables
11. RACI
12. Updates
13. Decisions
14. Meetings
15. Resources
16. Financials
17. Benefits
18. Documents
19. Governance
20. History

Overview includes:
- code/title;
- lifecycle/status;
- computed RAG;
- progress;
- Sponsor/PM;
- dates;
- sites/divisions;
- next milestone;
- top roadblocks;
- latest update;
- budget summary where authorized;
- executive commentary.

---

# 17. WORKSTREAMS

Fields:
- project;
- title;
- description;
- lead;
- participants;
- start/end;
- status;
- health;
- progress.

Can contain:
- tasks;
- milestones;
- roadblocks;
- risks;
- actions;
- deliverables.

---

# 18. TASKS

Formal planned work.

Fields:
- title;
- description;
- project;
- workstream;
- owner;
- collaborators;
- planned start;
- planned finish;
- actual start;
- actual finish;
- estimated hours;
- actual hours;
- priority;
- status;
- predecessor/dependencies;
- milestone;
- deliverable;
- version.

Statuses:

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
DONE
CANCELLED
```

Cancelled work is excluded from normal completion denominator unless reporting specifically includes it.

---

# 19. ACTIONS

Lightweight accountability item.

Example: “Network Lead to confirm carrier quotation by Friday.”

Fields:
- title;
- owner;
- due date;
- priority;
- status;
- source type;
- project;
- optional meeting;
- optional roadblock;
- optional CAPA;
- general/non-project flag;
- created by;
- timestamps.

Statuses:
- OPEN
- DONE
- CANCELLED

Cancelled never counts as completed.

Quick-add UX should support Enter.

---

# 20. GANTT AND DEPENDENCIES

Visual timeline for:
- workstreams;
- tasks;
- milestones.

Dependency types:
- FS;
- SS;
- FF;
- SF.

Support:
- lead/lag;
- baseline vs forecast;
- actual;
- drag-to-reschedule where authorized;
- critical path;
- workstream grouping;
- site filters;
- milestone markers.

Rescheduling baseline-critical work should create or require change-control behavior according to threshold/policy.

---

# 21. MILESTONES

Types:

- STANDARD
- SECURITY_GATE
- SITE_READINESS
- UAT
- GO_LIVE
- GOVERNANCE_GATE
- OPERATIONAL_HANDOVER

Fields:
- title;
- description;
- owner;
- optional Infra/Ops co-owner;
- project/workstream;
- baseline due;
- forecast due;
- actual completed;
- status;
- weight;
- linked tasks;
- linked deliverables;
- evidence;
- notes.

Statuses:
- NOT_STARTED
- IN_PROGRESS
- DONE
- SLIPPED
- CANCELLED

---

# 22. SITE READINESS

A SITE_READINESS milestone auto-generates the standard checklist:

1. Power
2. Rack / physical infrastructure
3. LAN
4. Local hands
5. Badge/access
6. Change window

Admin can define reusable readiness templates for:
- WAN;
- Wi-Fi;
- Firewall;
- Server;
- Backup;
- Monitoring;
- OT;
- Cybersecurity;
- Training;
- Vendor;
- Other.

Checklist item:
- requirement;
- site;
- owner;
- required/N/A;
- status;
- evidence;
- note;
- completion date.

---

# 23. PROJECT PROGRESS

No manual overall percentage.

Default:

```text
sum(weight of completed active milestones)
/
sum(weight of active milestones)
* 100
```

If no explicit weight:
- equal weight.

Define clear behavior for:
- cancelled milestones;
- newly added milestones;
- missing milestones;
- project before planning.

Progress UI must explain numerator/denominator.

Task completion may inform milestone readiness but may not allow arbitrary overall percentage.

---

# 24. RAG / HEALTH ENGINE

Overall RAG is computed.

Default core signals:

## Schedule
- no material overdue/slip → GREEN
- <=20% active milestones slipped/overdue → AMBER
- >20% → RED

## Roadblocks
- open CRITICAL → RED
- open MAJOR → AMBER

## Overdue actions
- 1–3 → AMBER
- 4+ → RED

## Freshness
- 21 days without status update → AMBER
- 30 days total silence → RED

RUN/CLOSED/ON_HOLD may be excluded from freshness according to policy.

Worst active core signal wins.

Optional additional health dimensions:
- budget;
- resource;
- risk;
- deliverable;
- CAPA;
- readiness.

They may either contribute to overall RAG or be displayed as independent signals based on configuration.

Every health card must explain “why”.

---

# 25. MANUAL RAG OVERRIDE

Authorized user may override.

Require:
- target color;
- reason >=30 characters;
- actor;
- timestamp;
- computed color;
- expiry/removal policy.

Display persistent `MANUAL` badge while active.

Audit permanently retains:
- reason;
- before;
- after;
- actor;
- timestamps.

---

# 26. FRESHNESS

Track:
- last explicit project status update;
- last milestone change;
- last task completion;
- last meaningful project activity.

The freshness rule should primarily use explicit status update age while supporting “total silence” detection from meaningful activity.

---

# 27. ROADBLOCKS

A current obstacle.

Fields:
- title;
- description;
- project/workstream;
- site;
- severity;
- owner;
- raised by/date;
- due date;
- impact;
- resolution approach;
- escalation state;
- resolution note/date;
- verification.

Severity:
- CRITICAL
- MAJOR
- MINOR

Lifecycle:

```text
RAISED
→ ASSIGNED
→ IN_PROGRESS
→ RESOLVED
→ VERIFIED
```

A resolved/verified roadblock cannot be escalated unless reopened with reason.

One-click escalation alerts:
- Admins as configured;
- engaged/lead Division Leads;
- owner;
- PM.

---

# 28. RISKS

Future uncertainty, separate from Roadblock.

Fields:
- description;
- category;
- probability;
- impact;
- inherent score;
- treatment;
- owner;
- target date;
- residual probability;
- residual impact;
- residual score;
- status.

Provide risk heatmaps by:
- project;
- portfolio;
- site;
- division;
- category.

---

# 29. CAPA

Corrective and Preventive Action.

Can originate from:
- roadblock;
- risk event;
- audit finding;
- repeated incident;
- project review;
- manual creation.

Fields:
- source;
- issue;
- root cause;
- immediate correction;
- corrective action;
- preventive action;
- owner;
- verifier;
- due date;
- evidence;
- verification date;
- effectiveness result.

Lifecycle:

```text
OPEN
→ ANALYSIS
→ ACTION_PLANNED
→ IMPLEMENTATION
→ VERIFICATION
→ CLOSED
```

Dashboards:
- overdue;
- waiting verification;
- recurrence;
- root cause trends;
- closure time;
- ineffective CAPA.

---

# 30. DELIVERABLES

Fields:
- name;
- description;
- project/workstream;
- Responsible;
- Accountable;
- planned date;
- status;
- acceptance criteria;
- accepted/rejected by;
- decision date;
- documents/evidence.

Statuses:
- NOT_STARTED
- IN_PROGRESS
- READY_FOR_REVIEW
- ACCEPTED
- REJECTED

R/A users can progress the deliverable according to policy without full project rights.

---

# 31. RACI

Apply to:
- project;
- workstream;
- deliverable;
- milestone;
- governance activity.

Roles:
- Responsible
- Accountable
- Consulted
- Informed

Quality checks:
- missing A;
- missing R;
- multiple A where disallowed;
- inactive user;
- user outside valid scope.

---

# 32. PROJECT UPDATES

Fast status update designed to take roughly 20 seconds.

Required:
- mood;
- one sentence <=400 characters.

Mood:
- POSITIVE
- NEUTRAL
- CONCERN
- CRITICAL

Optional:
- accomplishment;
- next step;
- support required.

Retain history.

Editing prior history creates revision rather than silent mutation.

---

# 33. EXECUTIVE COMMENTARY

Separate executive narrative.

Used in:
- executive dashboard;
- Steering review;
- project deck;
- group deck.

Latest approved/authorized commentary is exported verbatim.

Track revisions and author.

---

# 34. DECISION REGISTER

Fields:
- project;
- meeting optional;
- decision;
- decision maker;
- date;
- rationale;
- affected scope;
- follow-up action;
- attachments;
- audit metadata.

Chronological and auditable.

---

# 35. MEETING MANAGEMENT

Meeting types:
- Weekly Project Review
- Site Review
- Steering Committee
- Portfolio Review
- Operations Review
- Go-Live Readiness
- Ad Hoc

Fields:
- title;
- type;
- scope;
- scheduled start/end;
- organizer;
- participants;
- attendance;
- agenda;
- status;
- minutes versions.

Authorized Division Leads/Admins/appropriate PMs can create based on policy.

---

# 36. AUTO-AGENDA

Default rules:

1. RED projects
2. AMBER projects
3. roadblocks raised since previous closed sync
4. overdue actions grouped by owner
5. go-lives within 30 days
6. silent/stale projects
7. gates waiting approval
8. critical/overdue CAPA
9. major resource conflicts

Scope:
- Group
- Division
- Site
- Portfolio
- Program
- Project

Agenda items may be:
- reordered;
- pinned;
- removed from this meeting;
- manually added.

Removing an agenda item does not change source data.

---

# 37. LIVE MEETING MODE

Presentation-optimized interface.

Live capture commands:
- +Action
- +Decision
- +Roadblock
- +Risk
- +CAPA
- +Note

Tracked types become real objects immediately.

Presenter can pivot:

```text
GROUP
→ PORTFOLIO
→ PROGRAM
→ SITE
→ PROJECT
```

without leaving presentation mode.

Important information:
- RAG;
- progress;
- next milestone;
- top roadblocks;
- support/decision required;
- recent trend.

---

# 38. REAL-TIME MULTI-SCREEN MEETINGS

Use WebSockets or equivalent.

Support:
- presenter-selected context;
- room participants synced to presenter;
- remote users;
- opt-out into personal exploration where authorized;
- explicit “Follow presenter” state;
- reconnection.

Do not let realtime transport bypass normal authorization.

---

# 39. MEETING CLOSURE AND MINUTES

Closing compiles:
- date;
- attendees/absentees;
- agenda;
- project statuses;
- notes;
- decisions;
- roadblocks;
- risks;
- actions;
- owners/dates.

Finalized minutes are versioned.

Correction:
1. update underlying object;
2. regenerate/re-close;
3. retain prior version.

Outputs:
- web;
- print;
- PDF;
- copy-to-email;
- distribution.

---

# 40. RESOURCE MANAGEMENT

User capacity:
- working capacity;
- site/division;
- active allocations;
- availability;
- optional skill tags.

Allocation:
- project/workstream;
- person;
- start/end;
- planned percentage/hours;
- role.

Views:
- overload;
- under-allocation;
- cross-project conflicts;
- site capacity;
- division capacity;
- project demand;
- skill capacity.

Explain overload, e.g. “125% allocated across 4 projects.”

---

# 41. TIME TRACKING

Configurable by portfolio/project.

Entry:
- date;
- user;
- project;
- workstream;
- task;
- hours;
- description;
- approval if enabled.

Reports:
- planned vs actual;
- hours by project;
- site;
- division;
- resource;
- cost if rate policy enabled.

---

# 42. FINANCIAL MANAGEMENT

Field-level/module-level security.

Fields:
- currency;
- CAPEX/OPEX;
- approved budget;
- commitments;
- actual;
- forecast;
- estimate at completion;
- remaining forecast;
- variance;
- variance %.

Categories:
- Hardware
- Software
- Professional Services
- Telecom
- Travel
- Training
- Internal Resource
- Contingency
- Other

Financial restrictions must apply to:
- API;
- dashboard;
- search;
- report;
- export;
- scheduled distribution.

---

# 43. BENEFITS REALIZATION

Define during project initiation/planning.

Fields:
- benefit;
- owner;
- baseline;
- target;
- unit;
- measurement method;
- target date;
- actual result;
- status.

Examples:
- availability;
- incident reduction;
- cost saving;
- risk reduction;
- capacity;
- security maturity;
- productivity;
- satisfaction.

Benefits can continue during RUN and after technical go-live according to policy.

---

# 44. PERSONAL WORKSPACE — MY WORK

Sections:
- My Actions
- My Tasks
- My Milestones
- My Deliverables
- My CAPA
- My Approvals
- Projects I Manage
- Projects I Support
- Overdue
- Due This Week
- Upcoming

This should be the default daily operational workspace for Contributors and PMs.

---

# 45. PORTFOLIO WALL

KPI banner:
- total;
- green;
- amber;
- red;
- on hold;
- upcoming go-lives;
- overdue milestones;
- critical roadblocks;
- overdue actions;
- gates waiting.

Filters:
- site;
- division;
- portfolio;
- program;
- PM;
- RAG;
- lifecycle;
- pillar;
- priority;
- date.

KPI values recalculate under active filters.

Every KPI drills to its source list.

---

# 46. SITE LENS

One site’s complete authorized world:

- projects;
- RAG;
- deployments;
- milestones;
- go-lives;
- readiness;
- roadblocks;
- risks;
- CAPA;
- overdue work;
- people;
- workload;
- meeting history;
- local trend.

---

# 47. WAR ROOM

Governance command center.

Show:
- lifecycle;
- current gate;
- requirement checklist;
- missing evidence;
- approvals;
- approval ledger;
- RACI gaps;
- key deliverables;
- security gate;
- UAT;
- readiness;
- go-live blockers.

Example:

```text
PLANNING → EXECUTION
✓ Sponsor
✓ PM
✓ Milestones
✓ RACI
✓ Risks
✕ Resource plan
✓ Budget baseline
WAITING: Steering approval
```

---

# 48. EXECUTIVE COMMAND CENTER

Answer:
- what needs attention;
- what changed;
- what is red;
- what is late;
- upcoming go-lives;
- decisions required;
- site comparisons;
- overloaded teams;
- financial variance;
- benefit trend.

Recommended:
- portfolio health;
- top attention items;
- upcoming decisions;
- go-lives;
- RAG trend;
- site health;
- resource pressure;
- financial position.

---

# 49. ANALYTICS

## Project health
- distribution;
- trend;
- red aging.

## Schedule
- milestone on-time;
- slippage;
- baseline vs forecast.

## Actions
- open;
- overdue;
- completion;
- average resolution.

## Roadblocks
- severity;
- aging;
- escalation;
- resolution time.

## CAPA
- due;
- overdue;
- closure;
- root cause;
- effectiveness.

## Resource
- allocation;
- utilization;
- overload.

## Sites
- active projects;
- RAG;
- readiness;
- roadblocks;
- overdue.

## Finance
- budget;
- actual;
- commitment;
- forecast;
- variance.

## Governance
- gate cycle time;
- rejected gates;
- blocked gates;
- RACI quality;
- stale projects.

---

# 50. GLOBAL SEARCH

Search authorized:
- portfolios;
- programs;
- projects;
- users;
- workstreams;
- tasks;
- actions;
- milestones;
- roadblocks;
- risks;
- CAPA;
- deliverables;
- decisions;
- meetings.

Authorization is applied before results are returned.

Confidentiality tests must attempt:
- exact title;
- partial title;
- code;
- owner;
- associated site;
- direct ID/URL.

No leakage.

---

# 51. DOCUMENTS AND ATTACHMENTS

Attach/link to:
- project;
- task;
- milestone;
- roadblock;
- CAPA;
- decision;
- deliverable;
- meeting;
- gate evidence.

Metadata:
- filename;
- media type;
- size;
- uploader;
- version;
- description;
- classification;
- timestamps.

Use S3-compatible storage abstraction.

For enterprise production, provide SharePoint/OneDrive integration boundary rather than building a full enterprise document management product.

Validate:
- allowed types;
- max size;
- malicious filename handling;
- authorization;
- storage key isolation.

---

# 52. NOTIFICATION HUB

Triggers:
- PM assigned;
- task/action/milestone/deliverable assigned;
- reassignment;
- roadblock escalation;
- project turns red/amber;
- stale project;
- overdue;
- approaching due;
- go-live;
- meeting includes project;
- gate awaiting;
- gate result;
- CAPA due/overdue;
- offline sync halted;
- scheduled report failure.

Fields:
- type;
- recipient;
- severity;
- object link;
- read/unread;
- timestamps;
- deduplication key.

---

# 53. EMAIL AND TEAMS

Channels:
- in-app;
- email;
- Microsoft Teams.

Design via adapters/interfaces.

Local development:
- capture email with local mail sink;
- Teams fake/test adapter.

Production:
- environment-configured provider.

Mandatory governance alerts cannot be disabled by ordinary preference.

Delivery failures are observable/auditable.

---

# 54. REMINDER AND ESCALATION ENGINE

Default configurable schedule:

```text
T-14  upcoming
T-7   reminder
T-2   urgent
T0    due today
T+1   overdue
T+7   escalation
```

Rule by object/severity.

Use durable scheduled jobs with idempotency.

---

# 55. SCHEDULED REPORT DISPATCH

Configuration:
- report/template;
- filters;
- recipients;
- format;
- schedule;
- timezone;
- owner/security context;
- active;
- last run;
- next run;
- result.

Cadence:
- daily;
- selected weekdays;
- weekly;
- monthly.

Outputs:
- email body;
- PDF;
- PPTX;
- Excel;
- secure link.

Never expose records recipient is unauthorized to see.

---

# 56. EXPORT ENGINE

Authoritative server-side export source.

Outputs:
- PPTX;
- PDF;
- XLSX;
- printable web.

## Portfolio deck
Generated from current authorized filter scope.

Changing filter to a site must:
- adjust title;
- adjust KPI counts;
- include only that site’s authorized projects;
- update charts/tables.

## Project deck
Default:
1. Executive Summary
2. Scope/Objectives
3. Progress/Milestones
4. Timeline
5. Risks/Roadblocks
6. Actions/Decisions/Support Needed
7. Next Steps

Optional:
- finance;
- resource;
- readiness.

## Excel
Any meaningful tabular report can export filtered rows and visible/authorized columns.

---

# 57. OFFLINE CONTINUITY

PWA/local offline support.

Use durable local storage such as IndexedDB.

Queue is an ordered operation log.

Operation:
- client op ID;
- sequence;
- actor;
- target;
- operation;
- payload;
- base version;
- local timestamp;
- state.

Reconnect:
- replay sequentially;
- server validates current authorization/business rule/version;
- on first refusal/conflict, stop;
- later operations wait;
- show human resolution.

Admin receives appropriate notification for halted sync.

Human can:
- retry;
- inspect;
- discard.

Discard must be explicit and auditable locally/server-side when applicable.

Never automatically fabricate merge.

---

# 58. CONCURRENCY

Optimistic concurrency.

Editable object has:
- version integer or equivalent ETag.

Scenario:
- A reads v15;
- B reads v15;
- A saves → v16;
- B saves v15 → conflict;
- B receives current v16 and change context.

UI supports comparison/reapply.

No last-write-wins for core collaborative objects.

---

# 59. SOFT DELETE

Normal delete:
- `deletedAt`;
- `deletedBy`;
- reason;
- retained references;
- audit.

Admin-only.

Restore:
- validate uniqueness/referential constraints;
- audit restore.

No hard-delete UI/API for normal users/admin product flows.

Administrative retention tooling can be a separate controlled operational process outside ordinary application scope if legally required.

---

# 60. AUDIT

Append-only logical audit record.

Capture:
- actor;
- timestamp UTC;
- object type/id;
- operation;
- field-level changes where applicable;
- old/new safe value;
- source/channel;
- request correlation ID;
- project/site context;
- device/IP metadata only where policy allows.

Never capture:
- plaintext password;
- reset secret;
- auth token;
- API secret.

Security-sensitive values should be redacted.

Normal product has no audit update/delete operation.

Consider tamper-evident hashing/chain for stronger integrity if practical.

---

# 61. AUTHENTICATION

## Production target
Microsoft Entra ID OIDC/OAuth integration.

Support:
- SSO;
- MFA via tenant policy;
- user mapping;
- group mapping where configured;
- deactivation mapping;
- conditional access compatibility.

## Local fallback
Local auth for:
- development;
- controlled break-glass;
- test.

Policy:
- min password length >=10, configurable stronger;
- secure hashing;
- 5 wrong passwords → 15-minute lock;
- force change after admin reset;
- force change first login;
- login rate limits;
- API rate limits.

Do not log passwords.

---

# 62. SESSION MANAGEMENT

Support:
- secure cookies/token approach;
- rotation/refresh;
- persistent sessions across application restart when appropriate;
- logout;
- revoke all sessions;
- revocation after account disable/security reset;
- CSRF protection when cookie model requires it.

---

# 63. API SECURITY

Required:
- validation;
- authorization middleware/policy;
- object-level checks;
- site/project scoping;
- stable errors;
- rate limiting;
- secure headers;
- CORS policy;
- CSRF as applicable;
- SQL injection protection via ORM/parameterization;
- file upload validation;
- audit/correlation IDs.

Avoid revealing unauthorized resource existence through different 403/404 behavior where confidentiality requires concealment.

---

# 64. BACKUPS AND RECOVERY

Minimum:
- nightly backup;
- verification;
- at least 14-day retention;
- documented restore;
- rehearsed restore.

Target:
- encrypted backups;
- daily/weekly/monthly retention policy;
- RPO/RTO documented;
- quarterly restore exercise process.

Local/test environment must include automated backup + restore rehearsal scripts that prove data can be recovered.

A “backup job succeeded” flag alone is insufficient.

---

# 65. CANONICAL TIME

Store canonical timestamps in UTC.

Display can use user-selected/local timezone.

Audit remains UTC-based and unambiguous.

---

# 66. PRODUCT UX / DESIGN SYSTEM

Visual quality target: modern enterprise SaaS.

Principles:
- clean typography;
- dense but scannable information;
- progressive disclosure;
- consistent spacing;
- accessible contrast;
- visible state;
- predictable interactions;
- responsive layout.

High-frequency actions in 2–3 interactions where practical:
- add action;
- raise roadblock;
- post update;
- complete assigned item.

Support:
- command/search shortcut;
- keyboard quick-add;
- drag/drop where meaningful;
- skeleton/loading;
- empty;
- error;
- permission states.

---

# 67. MEETING/PRESENTATION DESIGN

Meeting mode is not ordinary form UI.

Use:
- large title/context;
- prominent RAG;
- prominent next milestone;
- major roadblocks;
- support/decision needed;
- high contrast;
- low navigation chrome;
- projector-readable layout.

---

# 68. RESPONSIVE AND ACCESSIBILITY

Desktop-first full functionality.

Mobile/tablet prioritize:
- My Work;
- action/task completion;
- updates;
- roadblocks;
- readiness;
- meeting participation;
- notifications.

Target WCAG 2.1 AA baseline.

Automate:
- axe or equivalent E2E accessibility checks;
- keyboard navigation for core flows.

---

# 69. INTERNATIONALIZATION

English + French.

Externalize all application labels/messages.

Localize:
- navigation;
- forms;
- statuses;
- errors;
- notifications;
- report template labels;
- date/number formatting.

User-entered content is not auto-translated.

---

# 70. TECHNICAL ARCHITECTURE — DEFAULT

Use a TypeScript monorepo unless an existing coherent repository architecture provides a better path.

Recommended:

```text
apps/
  web/          Next.js/React TypeScript application
  api/          NestJS or equivalent modular TypeScript API
  worker/       durable background job worker

packages/
  domain/       domain types/rules
  db/           schema, migrations, repository helpers
  auth/         identity/authorization policies
  contracts/    shared API contracts
  ui/           design system
  config/       validated environment/config
  observability/
  test-utils/
  export/
```

Infrastructure:
- PostgreSQL;
- Redis;
- durable queue such as BullMQ;
- S3-compatible object storage;
- local email sink;
- WebSocket transport;
- Docker Compose for local dependencies.

A single deployable modular monolith API + worker is preferred initially over unnecessary microservices.

Architecture must preserve module boundaries so future extraction is possible.

---

# 71. BACKEND MODULE BOUNDARIES

Recommended modules:

- Identity
- Organization
- Authorization
- Portfolio
- Program
- Project
- Governance/Gates
- Workstream
- Task
- Milestone/Readiness
- Action
- Risk
- Roadblock
- CAPA
- Deliverable/RACI
- Update/Commentary
- Decision
- Meeting/Realtime
- Resource/Time
- Finance
- Benefit
- Notification
- Reporting/Export
- Search
- Attachment
- Audit
- OfflineSync
- Admin/System

Avoid circular dependencies.

Use domain/application services and explicit authorization policies.

---

# 72. EVENT/OUTBOX MODEL

For reliable cross-cutting effects, use transactional domain events/outbox where appropriate.

Examples:
- ProjectManagerAssigned
- ActionAssigned
- MilestoneCompleted
- RoadblockEscalated
- ProjectHealthChanged
- GateApprovalRequested
- GateApproved
- MeetingClosed
- OfflineSyncHalted
- ReportScheduled

Database business change and outbox insert should occur in one transaction.

Worker processes outbox idempotently.

---

# 73. DATA MODEL — CORE ENTITIES

At minimum:

```text
Organization
Site
Division
Service
User
UserCredential
UserSession
UserMembership
UserPrivilege

StrategicPillar
Portfolio
Program
Project
ProjectSite
ProjectDivision
ProjectMember
ProjectBaseline
ProjectChangeRequest

LifecycleGate
GateRequirement
GateRequest
GateApproval

Workstream
Task
TaskDependency
Milestone
ReadinessTemplate
ReadinessTemplateItem
ReadinessChecklist
ReadinessChecklistItem

Action
Risk
Roadblock
CAPA

Deliverable
RaciAssignment
Decision
ProjectUpdate
ExecutiveCommentary

Meeting
MeetingParticipant
AgendaItem
MeetingNote
MeetingMinutesVersion

ResourceCapacity
ResourceAllocation
TimeEntry

ProjectBudget
BudgetLine
FinancialSnapshot

Benefit
BenefitMeasurement

Notification
NotificationDelivery
ScheduledReport
ScheduledReportRun

Attachment

AuditEvent
OutboxEvent
OfflineSyncOperation
```

Exact table names may vary.

---

# 74. DATABASE CONSTRAINTS

Use database constraints for important invariants when feasible:

- unique project code;
- unique emails normalized;
- valid date ranges;
- positive/valid hour values;
- valid percentages;
- unique dependency edge;
- prevent direct self-dependency;
- one primary PM per project;
- version fields;
- foreign keys;
- enum/state validity;
- uniqueness needed for deduplication/idempotency.

Add indexes for:
- site/project scope;
- active project lists;
- assignments;
- due dates;
- RAG;
- unread notifications;
- audit;
- search;
- queue/outbox.

---

# 75. AUTHORIZATION ENGINE

Implement explicit policy functions, for example:

```text
canReadProject(user, project)
canEditProjectCore(user, project)
canManageProjectWork(user, project)
canManageOwnedItem(user, item)
canCreateProject(user)
canAssignProjectManager(user, project)
canApproveGate(user, gate)
canViewFinancials(user, project)
canSetConfidentiality(user, project)
canDelete(user, object)
canViewAudit(user)
canCreateMeeting(user, scope)
canExport(user, scope)
```

Policies should be unit-testable without HTTP.

Do not scatter permission conditionals randomly across controllers.

---

# 76. PERMISSION MATRIX — REQUIRED TEST DIMENSIONS

Roles:
- Admin
- Division Lead
- Contributor
- Viewer

Flags/context:
- PM vs not PM
- Steering ON/OFF
- Enterprise ON/OFF
- same/different site
- lead/engaged/consulted/unrelated division
- Internal/Restricted/Confidential
- object owner/non-owner
- active/deactivated
- finance role/non-finance

Operations:
- list/read/search;
- create;
- edit project core;
- edit own task/action;
- create milestone;
- approve gate;
- set confidentiality;
- delete/restore;
- create/close meeting;
- view audit;
- export;
- view finance.

Negative tests are mandatory.

---

# 77. SEARCH AND AGGREGATION SECURITY

Queries must apply authorization before:
- count;
- group;
- trend;
- search ranking;
- autocomplete;
- export.

Do not query all data, aggregate, then “hide rows” in UI.

Test confidential project leakage through:
- total project count;
- RAG totals;
- owner workload;
- site counts;
- go-live counts;
- meeting agenda rules.

---

# 78. REPORTING SECURITY

All reports and scheduled exports:
- execute through server-side report service;
- apply user/recipient scope;
- use authorized fields;
- record filter specification;
- record generation result.

Do not let client send arbitrary hidden project IDs to export endpoint.

---

# 79. API CONTRACT

Expose documented typed APIs.

Recommended REST + OpenAPI for primary CRUD/workflows; WebSocket for live meeting/realtime events.

Every list endpoint:
- pagination;
- stable sorting;
- filter whitelist;
- authorization scope;
- maximum page size.

Every write endpoint:
- schema validation;
- current object version where relevant;
- authorization;
- transaction;
- audit;
- event/outbox.

---

# 80. ERROR MODEL

Use stable error codes, e.g.:

```text
AUTH_REQUIRED
ACCOUNT_DISABLED
ACCOUNT_LOCKED
FORBIDDEN
NOT_FOUND
VALIDATION_FAILED
CONFLICT_VERSION
GATE_REQUIREMENTS_NOT_MET
STEERING_APPROVAL_REQUIRED
INVALID_LIFECYCLE_TRANSITION
RAG_OVERRIDE_REASON_TOO_SHORT
OFFLINE_QUEUE_BLOCKED
RATE_LIMITED
```

Confidential inaccessible objects should generally return concealed not-found behavior.

UI translates safe messages.

---

# 81. BACKGROUND WORKER

Durable queue tasks:
- notification delivery;
- reminder generation;
- scheduled reports;
- export rendering;
- stale detection;
- RAG recalculation if asynchronous;
- CAPA escalation;
- benefit reminders;
- outbox processing;
- cleanup/retention jobs;
- backup verification trigger where architecture permits.

Required:
- retry policy;
- backoff;
- idempotency key;
- failure visibility;
- dead-letter/failed state;
- metrics.

---

# 82. OBSERVABILITY

Implement:
- structured logs;
- request correlation;
- worker/job correlation;
- health/readiness endpoints;
- database/Redis health;
- error reporting integration boundary;
- OpenTelemetry-ready traces/metrics.

Admin/system dashboard may show:
- failed jobs;
- queue backlog;
- notification failures;
- report failures;
- backup result;
- auth anomalies;
- sync conflicts.

Never log secrets.

---

# 83. LOCAL DEVELOPMENT EXPERIENCE

One documented startup path.

Recommended:

```text
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Exact commands may differ.

Requirements:
- deterministic seed;
- seeded users for each base role;
- example sites/divisions;
- projects across colors/stages/classifications;
- meetings;
- roadblocks;
- CAPA;
- finance examples;
- scheduled report example.

No production secrets required for local demo.

---

# 84. DEMO DATA

Create realistic but fictional seed:

- one Group;
- >=3 sites;
- 7 divisions;
- services;
- Admin;
- Division Leads;
- Contributors;
- Viewers;
- Steering/non-Steering examples;
- site-restricted account;
- confidential project PM;
- multiple portfolios/programs/projects;
- at least one project per lifecycle segment;
- green/amber/red examples;
- readiness/go-live example;
- roadblock/CAPA;
- meeting with minutes;
- financial data;
- resource overload scenario.

Seed is used by E2E tests where safe.

---

# 85. CI QUALITY PIPELINE

On pull/push as appropriate:

1. dependency install from lock;
2. formatting check;
3. lint;
4. type check;
5. unit tests;
6. integration/database tests;
7. build;
8. E2E critical tests;
9. security/dependency scan;
10. artifact/report tests as practical.

Fail fast but preserve test reports.

---

# 86. SECURITY TESTING

Automate and manually review:

- IDOR;
- role escalation;
- PM scoping;
- Steering bypass;
- confidentiality leakage;
- enterprise access leakage;
- Viewer write attempts;
- mass assignment;
- financial field leakage;
- export leakage;
- search leakage;
- direct URL leakage;
- upload authorization;
- session revocation;
- lockout/rate limit;
- CSRF where applicable;
- injection;
- XSS;
- unsafe HTML in commentary/updates;
- secret logging;
- audit tampering;
- soft-delete visibility.

No critical/high known issue at release.

---

# 87. UNIT TEST AREAS

Required domain unit tests:

- lifecycle transition function;
- gate requirements;
- permission policies;
- progress calculation;
- RAG core signals;
- manual override;
- freshness;
- task/dependency rules;
- critical-path utility;
- readiness template generation;
- roadblock transitions;
- CAPA transitions;
- RACI validation;
- financial calculations;
- resource overload;
- notification trigger logic;
- schedule/reminder calculation;
- export scope resolution;
- offline queue state machine.

---

# 88. INTEGRATION TEST AREAS

Against real test database/Redis where appropriate:

- user creation/auth;
- organization hierarchy;
- project code generation concurrency;
- project create/update;
- gate transitions;
- audit insertion;
- outbox atomicity;
- task dependencies;
- roadblock escalation;
- CAPA;
- meeting close;
- scheduled report;
- notification dedupe;
- soft delete/restore;
- optimistic concurrency;
- offline sync;
- attachment metadata;
- search scoping.

---

# 89. E2E ROLE JOURNEYS

## Admin
- login;
- manage users;
- set privileges;
- create organization objects;
- inspect audit;
- delete/restore.

## Division Lead
- create project;
- control lead project;
- limited engaged-project edit;
- create meeting.

## Contributor
- My Work;
- complete task/action;
- roadblock;
- status update;
- readiness;
- denied project core change.

## Viewer
- dashboard;
- project;
- report;
- export;
- all writes denied.

## PM
- full project operational flow;
- gates;
- Gantt;
- meeting;
- export.

## Steering member
- approve gate.

---

# 90. CRITICAL CROSS-CUTTING E2E JOURNEYS

## 90.1 Project lifecycle
Create → Initiation → Planning → Steering approval → Execution → Deployment → Go Live → Run → Closed.

## 90.2 Confidentiality
Unauthorized user sees zero trace; authorized PM sees project.

## 90.3 Site restriction
Restricted user’s dashboard/search/export all exclude other sites.

## 90.4 RAG
Seed signal changes and validate explanation.

## 90.5 Meeting
Auto agenda → live captures → closed minutes → corrected source → new minute version.

## 90.6 CAPA
Roadblock → CAPA → verification.

## 90.7 Resource
Allocation creates overload alert.

## 90.8 Export
Site filter produces matching deck/Excel with correct totals.

## 90.9 Offline
Queue replay/conflict/halt/human resolution.

## 90.10 Concurrency
Two browser contexts create conflict.

---

# 91. EXPORT TESTING

PPTX:
- file opens;
- expected slide count/sections;
- title adapts to filter;
- no unauthorized project strings;
- no confidential project IDs;
- key metrics match source query.

XLSX:
- workbook opens;
- expected columns;
- expected row count;
- formulas/values correct;
- unauthorized rows/fields absent.

PDF:
- valid file;
- expected title/text;
- no authorization leakage.

Snapshot testing may be used carefully, but semantic assertions are required.

---

# 92. PERFORMANCE TARGETS

Targets are practical baseline, not permission to sacrifice correctness.

- common authenticated navigation perceived quickly;
- primary dashboard server response target around <=2s in normal seeded/staging scale;
- paginated lists;
- indexed scope queries;
- no obvious N+1;
- background exports/jobs do not block API thread;
- virtualize very large tables/Gantt where needed.

Create representative load dataset and benchmark critical queries.

---

# 93. RELIABILITY REQUIREMENTS

- transactions for multi-record invariants;
- idempotent workers;
- durable outbox;
- durable jobs;
- retry with bounded backoff;
- graceful shutdown;
- migration rollback/recovery strategy;
- health checks;
- no silently swallowed exceptions;
- user-visible failure states.

---

# 94. DATA QUALITY ENGINE

Detect:
- missing Sponsor;
- missing PM;
- no milestones after planning;
- ownerless milestone;
- deliverable without R/A;
- invalid date order;
- inactive assignee;
- missing site/division;
- stale update;
- blocked gate;
- duplicate/invalid relationships.

Provide PMO quality dashboard/score.

---

# 95. PROJECT TEMPLATES

Admin/PMO can define templates.

Examples:

## Network Upgrade
- design;
- procurement;
- install;
- test;
- change;
- readiness;
- go-live;
- handover.

## Application Deployment
- requirements;
- security assessment;
- build;
- UAT;
- migration;
- training;
- go-live.

Template can preload:
- workstreams;
- milestones;
- tasks;
- readiness;
- deliverables;
- RACI suggestions;
- gate evidence checklist.

Instantiation copies template version so future template edits do not silently mutate existing projects.

---

# 96. PORTFOLIO PRIORITIZATION

Configurable criteria:
- strategic alignment;
- risk reduction;
- business value;
- regulation;
- urgency;
- operational impact;
- effort;
- cost.

Compute a transparent score.

Score informs prioritization but does not auto-approve.

---

# 97. MANAGEMENT-BY-EXCEPTION BRIEF

Generate personalized attention list.

PM:
- overdue milestones;
- critical roadblocks;
- overdue actions;
- gate due.

Division Lead:
- red projects;
- overloaded people;
- upcoming go-lives;
- overdue CAPA.

Executive:
- intervention projects;
- decisions waiting;
- health trend.

Implement as dashboard first; optional digest notification thereafter.

---

# 98. ADMINISTRATION CENTER

Sections:
- Users
- Sites
- Divisions
- Services
- Pillars
- Portfolios
- Roles/privileges
- Steering Committee
- Security
- Notification rules
- Report templates
- Project templates
- Readiness templates
- Lifecycle/gate configuration
- Audit
- Deleted records
- Backup health
- Jobs/system health

Restrict appropriately.

---

# 99. NAVIGATION

Primary:

```text
Home
Portfolio
Programs
Projects
Sites
My Work
Meetings
War Room
Reports
Resources
Search
Notifications
Administration
```

Show only authorized destinations.

Project:

```text
Overview
Plan
Workstreams
Tasks
Milestones
Actions
Roadblocks
Risks
CAPA
Deliverables
RACI
Updates
Decisions
Meetings
Resources
Financials
Benefits
Documents
Governance
History
```

---

# 100. EXPLICIT REFUSALS / INVARIANTS

The system must refuse:

- arbitrary typed project progress;
- arbitrary RAG selection without authorized override;
- short/empty override reason;
- stage skipping;
- PLANNING→EXECUTION without Steering approval;
- Viewer write;
- Viewer PM assignment;
- unauthorized confidential access;
- unauthorized cross-site access;
- silent concurrent overwrite;
- normal hard delete;
- non-Admin delete;
- direct finalized-minute edit;
- escalation of closed roadblock without reopen;
- locked-account login;
- rate-limit bypass;
- local reset account use before required password change;
- machine auto-resolution of sync conflict;
- audit mutation;
- approval-ledger mutation.

---

# 101. DEFAULT REPOSITORY STRUCTURE

Recommended:

```text
.
├─ .claude/
│  ├─ skills/
│  │  └─ goal/
│  │     └─ SKILL.md
│  └─ agents/                 # optional specialist agents
├─ apps/
│  ├─ web/
│  ├─ api/
│  └─ worker/
├─ packages/
│  ├─ auth/
│  ├─ config/
│  ├─ contracts/
│  ├─ db/
│  ├─ domain/
│  ├─ export/
│  ├─ observability/
│  ├─ test-utils/
│  └─ ui/
├─ docs/
│  ├─ adr/
│  ├─ architecture/
│  ├─ operations/
│  └─ execution/
├─ infra/
├─ tests/
│  └─ e2e/
├─ PROJECT_MASTER_PLAN.md
├─ CLAUDE.md
├─ README.md
├─ compose.yaml
└─ package.json
```

Actual structure may adapt while preserving responsibilities.

---

# 102. REQUIRED ENGINEERING DOCUMENTATION

Produce:

- README;
- architecture overview;
- module boundaries;
- authorization model;
- data model/ERD;
- lifecycle/gate specification;
- RAG specification;
- offline/concurrency design;
- realtime design;
- export/report design;
- environment configuration;
- local setup;
- testing guide;
- production deployment guide;
- backup/restore runbook;
- incident/operations runbook;
- SSO integration guide;
- email/Teams integration guide;
- admin guide;
- API/OpenAPI;
- ADRs for major choices.

---

# 103. CLAUDE EXECUTION MEMORY

The autonomous orchestrator must maintain:

```text
docs/execution/STATUS.md
docs/execution/REQUIREMENT_TRACEABILITY.md
docs/execution/TEST_MATRIX.md
docs/execution/DECISIONS.md
docs/execution/OPEN_ISSUES.md
docs/execution/EXTERNAL_DEPENDENCIES.md
docs/execution/RELEASE_READINESS.md
```

These are not product features; they ensure autonomous development continuity.

---

# 104. DELIVERY EPICS

Each epic is incomplete until its acceptance tests pass.

## EPIC E00 — Foundation
Deliver:
- workspace;
- apps/packages;
- strict TS;
- environment validation;
- local infra;
- CI;
- logging;
- health;
- seed framework.

Acceptance:
- clean install;
- dependencies start;
- DB migrates;
- seed runs;
- web/API/worker start;
- lint/type/unit/build pass.

## EPIC E01 — Organization & Users
Deliver organization/site/division/service/user management.

Acceptance:
- Admin CRUD excluding hard delete;
- hierarchy works;
- memberships work;
- unauthorized users denied;
- audit exists.

## EPIC E02 — Auth & Sessions
Local auth + Entra adapter.

Acceptance:
- lockout;
- password reset/change;
- first-login change;
- session revoke;
- deactivation;
- mocked Entra flow tests.

## EPIC E03 — Authorization & Classification
RBAC + modifiers + object policy.

Acceptance:
- permission matrix;
- Viewer negative tests;
- site scope;
- confidentiality zero-leak tests;
- Steering independence.

## EPIC E04 — Portfolio/Program/Project
Deliver core portfolio hierarchy and Project Room shell.

Acceptance:
- code generation concurrency safe;
- PM assignment;
- divisions/sites;
- search scope;
- audit.

## EPIC E05 — Lifecycle & Governance
Gates, War Room, ledger.

Acceptance:
- no skips;
- requirements;
- Steering gate;
- ledger immutable;
- UI explains blockers.

## EPIC E06 — Change/Baseline
Acceptance:
- change request;
- approval;
- preserved original baseline;
- forecast separate.

## EPIC E07 — Workstreams/Tasks/Gantt
Acceptance:
- task CRUD authorized;
- dependencies;
- cycle prevention;
- Gantt;
- critical path;
- forecast/baseline.

## EPIC E08 — Milestones/Progress/Readiness
Acceptance:
- milestone types;
- readiness auto-create;
- weighted progress;
- no manual overall progress.

## EPIC E09 — Actions
Acceptance:
- quick create;
- assignment notification;
- done/cancel;
- source linking;
- overdue analytics.

## EPIC E10 — Health
Acceptance:
- four default signals;
- worst wins;
- explanation;
- freshness exclusions;
- manual override.

## EPIC E11 — Risk/Roadblock/CAPA
Acceptance:
- distinct semantics;
- escalation;
- reopen controls;
- CAPA workflow;
- effectiveness verification.

## EPIC E12 — Deliverable/RACI
Acceptance:
- R/A can progress;
- RACI quality warnings;
- acceptance.

## EPIC E13 — Updates/Decisions
Acceptance:
- fast update;
- revisions;
- executive commentary export;
- decision register.

## EPIC E14 — Meetings
Acceptance:
- auto-agenda;
- scope;
- attendance;
- live captures;
- close;
- versioned minutes.

## EPIC E15 — Realtime Meeting Mode
Acceptance:
- follow presenter;
- reconnect;
- authorization;
- presentation UX.

## EPIC E16 — Resources/Time
Acceptance:
- capacity;
- allocation;
- overload;
- time entry;
- analytics.

## EPIC E17 — Finance
Acceptance:
- budget/actual/forecast;
- variance;
- financial permission tests;
- export security.

## EPIC E18 — Benefits
Acceptance:
- baseline/target;
- measurement;
- owner;
- RUN tracking.

## EPIC E19 — Notifications
Acceptance:
- in-app triggers;
- dedupe;
- preferences;
- mandatory alerts.

## EPIC E20 — Email/Teams
Acceptance:
- production interface;
- dev fake/sink;
- retry/failure logging;
- no build blockage without real credential.

## EPIC E21 — Scheduling/Workers
Acceptance:
- reminders;
- escalations;
- scheduled reports;
- idempotency;
- failure state.

## EPIC E22 — Dashboards/Analytics
Acceptance:
- Portfolio Wall;
- Site Lens;
- My Work;
- War Room;
- Executive;
- drilldown;
- scope-consistent KPIs.

## EPIC E23 — Exports
Acceptance:
- PPTX;
- PDF;
- XLSX;
- filter parity;
- authorization parity;
- semantic file tests.

## EPIC E24 — Search/Documents
Acceptance:
- global search;
- attachment storage adapter;
- authorization;
- classification.

## EPIC E25 — Offline
Acceptance:
- offline changes;
- ordered replay;
- halt;
- retry/discard;
- auth/version conflicts.

## EPIC E26 — Concurrency
Acceptance:
- version conflict;
- UX comparison/reapply;
- no silent overwrite.

## EPIC E27 — Backup/Recovery/Operations
Acceptance:
- backup;
- verify;
- restore rehearsal;
- health;
- logs;
- runbooks.

## EPIC E28 — i18n/Accessibility/Responsive
Acceptance:
- English/French;
- mobile operations;
- WCAG baseline;
- automated accessibility smoke.

## EPIC E29 — Security Hardening
Acceptance:
- threat model;
- security test suite;
- no known high/critical;
- secret/log review.

## EPIC E30 — Release Qualification
Acceptance:
- all traceability complete;
- all critical journeys;
- fresh DB install;
- production build;
- seed/demo;
- documentation;
- release readiness.

---

# 105. IMPLEMENTATION WAVES

## Wave 1 — Foundation
E00–E04

## Wave 2 — Governance
E05–E06, E11–E12

## Wave 3 — Execution
E07–E10

## Wave 4 — Collaboration
E13–E15

## Wave 5 — Enterprise Management
E16–E18

## Wave 6 — Automation & Reporting
E19–E23

## Wave 7 — Continuity & Productization
E24–E29

## Wave 8 — Final Release
E30

Waves guide sequencing; vertical completion and dependency correctness take priority.

---

# 106. DEFINITION OF DONE — FEATURE

A feature is done only if applicable:

- database/migration complete;
- domain logic complete;
- backend API complete;
- authorization complete;
- audit complete;
- events/notifications complete;
- frontend complete;
- loading/empty/error states;
- i18n strings;
- unit tests;
- integration tests;
- permission negative tests;
- E2E;
- docs;
- traceability.

A UI mock connected to fake local data is not done unless the feature is explicitly an external integration fake with a production adapter.

---

# 107. DEFINITION OF DONE — PROJECT

Project release candidate requires:

## Functional
All epics accepted.

## Governance
All invariants enforced.

## Security
No known critical/high findings and authorization matrix green.

## Data
Fresh migrations + seed + restore test succeed.

## Quality
Formatting/lint/typecheck/tests/build green.

## E2E
Critical journeys green.

## Reporting
Exports valid and leak-tested.

## Offline/concurrency
Conflict tests green.

## UX
Core responsive/accessibility flows green.

## Operations
Health, logs, worker status, backup/restore, runbooks.

## Documentation
Complete enough to deploy/administer/use without hidden tribal knowledge.

## Traceability
No orphaned master requirement.

---

# 108. RELEASE ACCEPTANCE JOURNEYS

The following are mandatory release-gate journeys.

### RA-01 Admin provisioning
Create site/division/user, privilege, reset, audit.

### RA-02 Full lifecycle
Idea to Closed with gate checks.

### RA-03 Contributor restriction
Owned changes allowed; core/admin actions denied.

### RA-04 Viewer read-only
Authorized reading/export; all writes server-rejected.

### RA-05 Steering separation
Admin without Steering denied; Steering-authorized approver succeeds.

### RA-06 Enterprise access
Site-restricted user sees no cross-site trace.

### RA-07 Confidentiality
Unauthorized user cannot infer project.

### RA-08 Progress
Milestone completion recalculates explained percentage.

### RA-09 RAG
All four default signals and override validated.

### RA-10 Roadblock/CAPA
Escalation, resolution, reopen, CAPA verification.

### RA-11 Meeting
Agenda → live capture → minutes → version correction.

### RA-12 Go-live readiness
Checklist → gate → GO_LIVE → RUN.

### RA-13 Resource
Allocation overload explained.

### RA-14 Finance
Variance correct and unauthorized user cannot access.

### RA-15 Portfolio reporting
Filtered dashboard matches PPTX/PDF/XLSX.

### RA-16 Scheduled dispatch
Report runs, recipient scope applied, result logged.

### RA-17 Concurrency
No silent overwrite.

### RA-18 Offline
Ordered replay and conflict halt.

### RA-19 Backup/restore
Seed data backed up, destructive test reset, restore recovers expected records.

### RA-20 i18n/accessibility
Core journey in EN/FR, keyboard and axe smoke pass.

---

# 109. TEST COMMAND CONTRACT

Repository should expose simple root commands equivalent to:

```text
dev
build
lint
format:check
typecheck
test
test:unit
test:integration
test:e2e
test:security
test:a11y
db:migrate
db:seed
db:reset
backup
restore:test
```

Exact package-manager syntax can differ.

A single CI command may aggregate release checks.

---

# 110. EXTERNAL DEPENDENCIES POLICY

The autonomous build must not stop because real production credentials do not exist.

Implement integration boundaries and local substitutes for:

- Entra;
- Teams;
- SMTP;
- SharePoint/OneDrive;
- object storage;
- production observability;
- cloud deployment.

Maintain `docs/execution/EXTERNAL_DEPENDENCIES.md`.

Each entry:
- integration;
- code status;
- test status;
- exact production variable/resource required;
- validation procedure after credential is available.

---

# 111. NON-GOALS / AVOIDED COMPLEXITY

Unless required by a later explicit specification:

- do not build a generic ERP;
- do not build full SharePoint replacement;
- do not build payroll;
- do not build source-control/project-code hosting;
- do not build a generic chat platform;
- do not use microservices only for fashion;
- do not introduce AI decision-making that auto-approves gates, auto-resolves conflicts, or changes governance facts without human authority.

AI assistance may summarize or suggest in future, but deterministic governance remains authoritative.

---

# 112. SECURITY THREAT MODEL — MINIMUM

Threat actors:
- unauthenticated outsider;
- compromised Viewer;
- malicious Contributor;
- cross-site user;
- curious insider;
- stale/deactivated user;
- compromised browser session;
- malicious file uploader.

Assets:
- confidential project metadata;
- financials;
- audit;
- approvals;
- identities;
- reports;
- attachments;
- session tokens.

High-priority threats:
- IDOR;
- privilege escalation;
- cross-site leakage;
- confidential aggregation leakage;
- export leakage;
- session theft;
- XSS;
- injection;
- file abuse;
- audit tampering;
- offline replay abuse;
- duplicate job effects.

Document mitigations and tests.

---

# 113. PRIVACY AND LOGGING

Use least-necessary operational data.

Never log:
- password;
- auth bearer token;
- reset token;
- raw secret.

Redact sensitive request fields.

Avoid unnecessary personal data in metrics.

---

# 114. DATA RETENTION

Configurable retention for:
- notifications;
- technical logs;
- generated temporary exports;
- sessions;
- failed job payloads.

Business records/audit follow enterprise retention policy and must not be silently purged by generic cleanup jobs.

---

# 115. ACCESSIBILITY CHECKLIST

Core:
- semantic headings;
- form labels;
- focus visibility;
- keyboard navigation;
- dialog focus trap/return;
- table semantics;
- error association;
- contrast;
- non-color-only state;
- reduced motion respect where practical;
- screen-reader names for icon buttons.

RAG must include text/icon, not color only.

---

# 116. UX EMPTY/ERROR STATES

Every major list/view must define:
- first-time empty;
- filtered empty;
- permission-limited empty;
- server error;
- offline;
- stale/retry.

Avoid generic blank screens.

---

# 117. DATA EXPLAINABILITY EXAMPLES

RAG:
> RED — Critical roadblock RB-014 is open.

Progress:
> 4 completed milestone weight / 6 active weight = 66.7%.

Resource:
> 125% allocation: Project A 50%, Project B 50%, Project C 25%.

Variance:
> Forecast 112,000 vs approved 100,000 = +12%.

Gate:
> Blocked: resource plan missing and risk register has no owner for 2 high risks.

---

# 118. AUDITABLE AUTOMATION

When background automation changes derived state:
- preserve source event/time;
- record system actor or derivation metadata;
- avoid pretending a human made the change.

Notifications and report runs should have execution records.

---

# 119. USER NOTIFICATION PREFERENCES

Allow preferences for non-mandatory:
- assignment;
- reminder;
- digest;
- meeting;
- report.

Do not allow ordinary user to suppress mandatory security/governance alerts if policy marks them mandatory.

---

# 120. REALTIME AUTHORIZATION

On WebSocket:
- authenticate connection;
- authorize room join;
- revalidate relevant project access;
- avoid broadcasting confidential payload to unauthorized socket then filtering client-side;
- remove/deauthorize on membership/session change where practical.

---

# 121. ATTACHMENT SECURITY

Requirements:
- random storage keys;
- original filename metadata separate;
- size/type validation;
- authorization on download;
- signed/streamed secure access;
- avoid path traversal;
- no public bucket by default;
- antivirus scanning integration point for production.

---

# 122. SEARCH IMPLEMENTATION

Start with PostgreSQL full-text/trigram or suitable indexed search for maintainability.

Abstract search service so dedicated engine can be introduced later if scale requires it.

Authorization/scoping remains source of truth.

---

# 123. REPORT GENERATION IMPLEMENTATION

Recommended:
- XLSX: server library such as ExcelJS or equivalent;
- PPTX: PptxGenJS or equivalent;
- PDF: render controlled HTML/print template through headless browser or equivalent.

Use reusable branded template definitions.

Generated files:
- deterministic titles;
- UTC generation metadata;
- filter summary;
- confidentiality marking where relevant.

---

# 124. REALTIME/MEETING IMPLEMENTATION

Recommended:
- WebSocket gateway;
- room keyed by meeting;
- presenter state stored server-side/Redis for reconnect;
- event sequence/version to prevent out-of-order display;
- persistent business captures through normal API/domain services.

Realtime event is not itself the durable business record.

---

# 125. OFFLINE IMPLEMENTATION

Recommended client architecture:
- PWA service worker for app shell/network behavior;
- IndexedDB for queue/cache;
- explicit sync service;
- server `/sync` or normal idempotent endpoints with operation IDs.

Do not cache confidential data beyond authorization/session policy without considering local device exposure. Clear sensitive caches on logout/revocation where feasible.

---

# 126. OPTIMISTIC UI

Allowed for low-risk actions where rollback is safe.

Governance transitions, approvals, delete, confidentiality and financial changes should confirm server result before presenting final state.

---

# 127. DATABASE TRANSACTIONS — REQUIRED EXAMPLES

Use transactions for:
- project creation + code + memberships;
- gate approval + lifecycle transition + ledger;
- meeting close + minutes snapshot;
- change approval + baseline;
- soft delete + audit;
- business event + outbox.

---

# 128. IDEMPOTENCY — REQUIRED EXAMPLES

Use idempotency for:
- offline replay;
- notification dispatch;
- scheduled report run;
- outbox consumption;
- integration delivery.

Duplicate processing must not create duplicate actions/approvals/reports unexpectedly.

---

# 129. PROJECT CODE GENERATION

Must be safe under simultaneous project creation.

No “max(code)+1” without locking/sequence safety.

Test concurrent creation.

---

# 130. CLOSED PROJECT BEHAVIOR

Closed project:
- default read-only operationally;
- admin/authorized governance correction goes through controlled reopen/change mechanism if required;
- history preserved;
- no freshness penalty;
- reporting remains available.

---

# 131. ON-HOLD BEHAVIOR

Record:
- hold reason;
- hold start;
- expected resume;
- resumed date.

Freshness behavior excluded/adjusted according to defined policy.

Overdue items may remain visible but clearly contextualized as on hold.

---

# 132. CANCELLATION

Require:
- reason;
- decision maker/authority;
- date;
- outstanding task/action disposition;
- financial/contract note if enabled.

Retain in portfolio history, not delete.

---

# 133. RAG TREND

Persist health snapshots/event history enough to chart:
- daily or change-based RAG;
- reason;
- computed/manual.

Do not derive historical trend solely from current state.

---

# 134. REPORTING SNAPSHOTS

For finalized meeting minutes and gate approvals, store enough snapshot data to reconstruct what was reviewed at that time.

Live dashboards may remain current.

---

# 135. NOTIFICATION DEDUPLICATION

Avoid daily spam.

A state-based alert should not repeatedly create identical notifications unless:
- reminder policy calls for repeat;
- severity changes;
- due escalation threshold changes.

---

# 136. PMO GOVERNANCE DASHBOARD

Detect:
- no Sponsor;
- no PM;
- no milestone;
- ownerless milestone;
- deliverable missing R/A;
- overdue roadblock;
- stale;
- missing update;
- gate blocked;
- missing closure;
- poor data quality.

---

# 137. REPORT FILTER MODEL

Reusable filter object:
- site(s);
- division(s);
- portfolio(s);
- program(s);
- project(s);
- PM(s);
- lifecycle;
- status;
- RAG;
- pillar;
- priority;
- date range.

The same filter semantics should be used by dashboard and exports.

---

# 138. URL/DEEP LINKING

Key screens should support shareable authorized URLs:
- project;
- meeting;
- action;
- roadblock;
- report/filter view.

Unauthorized user gets concealed/not-found as appropriate.

---

# 139. PAGINATION AND LARGE DATA

Use server pagination for large lists.

Do not fetch entire enterprise portfolios merely to filter in browser.

---

# 140. FORM VALIDATION

Use shared schema where practical between client/API.

Client validation improves UX; server validation is authoritative.

---

# 141. DATE RULES

Validate:
- project target after appropriate start;
- task end >= start;
- actual finish rules;
- milestone dates;
- allocation ranges;
- benefit measurement.

Allow legitimate retrospective project entry through explicit policy rather than arbitrary blocking.

---

# 142. PROJECT TEAM ASSEMBLY

PM can search authorized users and assign project roles.

Cross-functional membership records:
- user;
- project;
- role;
- site context optional;
- workstream optional;
- start/end optional.

Notify assignments.

---

# 143. DIVISION RELATION TYPES

Project divisions:
- LEAD
- ENGAGED
- CONSULTED

Authorization:
- LEAD Division Lead broad project control;
- ENGAGED/CONSULTED Division Lead only their division-owned execution objects unless PM/extra role.

Test.

---

# 144. SITE RELATION

Projects may affect multiple sites.

Site Lead assignment can be per project/site.

Readiness is site-specific.

A multi-site project may have separate readiness milestones/checklists per site.

---

# 145. FINANCIAL FIELD MASKING

If a user lacks finance permission:
- API response omits/does not expose values;
- UI tab hidden or access denied;
- export excludes;
- search indexes do not surface;
- audit access to finance changes follows audit role policy.

---

# 146. EXECUTIVE COMMENTARY EXPORT

Deck must use exact current approved commentary text, subject only to safe rendering/escaping.

Do not summarize automatically unless separately requested.

---

# 147. MINUTES IMMUTABILITY

A closed minutes version is a snapshot.

New close creates next version.

Previous version remains viewable to authorized users.

---

# 148. BACKUP RESTORE TEST

Automated test/runbook:
1. create deterministic marker data;
2. backup;
3. reset/remove test DB data;
4. restore;
5. assert marker and relationships;
6. report result.

Never run destructive restore rehearsal against production automatically.

---

# 149. PERFORMANCE DATASET

Create optional seed/load generator with:
- hundreds/thousands projects;
- multiple sites;
- many actions/tasks;
- audit events.

Use to profile:
- portfolio dashboard;
- My Work;
- search;
- analytics;
- audit list.

---

# 150. BROWSER SUPPORT

Modern:
- Edge;
- Chrome;
- Firefox;
- Safari.

Use standards-based implementation.

---

# 151. DEPLOYMENT

Provide production-ready containerization.

Minimum:
- web image;
- API image;
- worker image;
- migration command/job;
- environment schema;
- health checks.

Provide generic deployment documentation and optionally Compose/Kubernetes/IaC templates based on repository direction.

Do not require cloud credentials to complete code.

---

# 152. CONFIGURATION

All config validated at startup.

Categories:
- database;
- Redis;
- URLs;
- auth;
- object storage;
- email;
- Teams;
- Entra;
- session secrets;
- export;
- observability.

`.env.example` contains names and safe examples, no secrets.

---

# 153. SECRET MANAGEMENT

Production docs require external secret manager or protected platform secrets.

Never commit real keys.

Add secret scanning in CI where practical.

---

# 154. DEPENDENCY MANAGEMENT

- lockfile committed;
- automated vulnerability scan;
- avoid unnecessary dependency explosion;
- document important third-party license/operational implications.

---

# 155. MIGRATION STRATEGY

From scratch:
- baseline schema migrations;
- no manual DB edits.

Every schema evolution:
- migration;
- test;
- seed compatibility.

Fresh database must reach latest state automatically.

---

# 156. API VERSIONING

Use stable `/api/v1` or equivalent if appropriate.

Avoid premature multi-version complexity, but prevent accidental breaking of external integration surface.

---

# 157. FEATURE FLAGS

Use only when necessary for:
- external integration rollout;
- experimental module.

Do not hide unfinished required scope permanently behind feature flags to claim completion.

---

# 158. OBSERVABILITY DASHBOARD DATA

Expose admin-friendly status:
- API uptime;
- worker health;
- DB;
- Redis;
- failed jobs;
- queue backlog;
- report runs;
- notification failures;
- last backup verify;
- active sync conflicts.

---

# 159. AUDIT VIEW

Admin/auditor filtering:
- date;
- actor;
- project;
- entity type;
- operation;
- site;
- correlation.

Field diff display safely escapes content.

---

# 160. SOFT DELETE VIEW

Admin can:
- list deleted;
- filter;
- inspect reason/history;
- restore if valid.

Never silently restore dependent objects with conflicting state.

---

# 161. USER DEACTIVATION

Deactivating user:
- blocks new login;
- revokes sessions;
- retains historical ownership/audit;
- highlights active future assignments for reassignment;
- does not delete history.

---

# 162. PASSWORD RESET

Admin reset:
- generates secure temporary/reset flow;
- invalidates/revokes as policy;
- user must set own password;
- password itself never shown in audit.

For dev seed accounts, documented safe local credentials may be used only in non-production seed.

---

# 163. LOCKOUT

5 bad passwords within policy window → 15-minute lock.

Admin unlock allowed and audited.

Test concurrent/boundary attempts.

---

# 164. RATE LIMITS

Apply:
- login stricter;
- password reset;
- search reasonable;
- APIs global/user;
- exports/scheduled expensive endpoints.

Return safe rate-limited response.

---

# 165. FRONTEND STATE AND DATA FETCHING

Use a coherent query/cache strategy.

Server remains authoritative.

Invalidate/update caches after writes to avoid stale dashboards.

Realtime updates may patch relevant caches.

---

# 166. DESIGN SYSTEM COMPONENTS

At minimum:
- buttons;
- inputs;
- selects;
- combobox;
- date picker;
- modal/dialog;
- drawer;
- tabs;
- table;
- pagination;
- cards;
- KPI tile;
- badges;
- RAG indicator;
- progress;
- timeline;
- toast;
- alert;
- skeleton;
- empty state;
- error state;
- command/search;
- user/avatar;
- breadcrumbs;
- permission guard for UX only;
- charts wrapper.

---

# 167. RAG ACCESSIBILITY

Render:
- color;
- text (`RED`, `AMBER`, `GREEN`);
- icon/shape.

Never rely on color alone.

---

# 168. CHARTS

Charts should:
- have accessible titles/labels;
- permit drilldown;
- use authorized data;
- show empty state;
- avoid deceptive truncated scales;
- display filter scope.

---

# 169. PDF/PPT BRANDING

Create central theme:
- typography;
- spacing;
- headers/footers;
- page/slide numbering;
- generation date;
- scope title;
- confidentiality marking where appropriate.

No manual rework expected for routine use.

---

# 170. PRINTING

Meeting minutes and project summary have print stylesheet.

No clipped tables or invisible RAG text.

---

# 171. API AUDIT CORRELATION

Each request has correlation ID.

Audit/outbox/logs use it where relevant.

This allows incident reconstruction.

---

# 172. SYSTEM ACTOR

Automated changes/notifications use explicit SYSTEM actor or metadata, not fake human user.

---

# 173. SCHEDULE TIMEZONE

System canonical UTC.

Scheduled report allows configured business timezone.

Persist timezone identifier, not only numeric offset.

---

# 174. REPORT RECIPIENT SECURITY

Before sending:
- resolve recipient identity where internal;
- compute allowed scope;
- intersect report owner/requested filter with recipient permissions;
- if external email distribution is introduced, require explicit secure policy rather than assuming access.

Default: scheduled business reports go to known internal users.

---

# 175. EMAIL COPY OF MINUTES

“Copy to email” generates sanitized formatted content.

It does not silently send unless user invokes send/distribution action or a configured scheduled/distribution flow is used.

---

# 176. MY ACTION CHASING

Overdue reminders should be generated automatically.

Avoid duplicating several identical alerts in a short period.

---

# 177. DATA EXPORT AUDIT

Record:
- user;
- report type;
- scope/filter;
- format;
- generated time;
- success/failure.

Avoid storing full exported sensitive content in audit log.

---

# 178. FILE RETENTION

Temporary generated exports expire according to policy.

Regenerate as needed.

Do not leave permanent public links.

---

# 179. TEST DATA ISOLATION

E2E runs use isolated database/schema and object storage namespace.

Tests can run repeatedly without dependence on prior order.

---

# 180. FLAKE POLICY

Do not accept flaky tests as normal.

Fix race/time dependencies.

Use fake clocks for reminder/freshness tests where practical.

---

# 181. CLOCK ABSTRACTION

Domain logic dependent on “now” should use injectable clock/service to make:
- freshness;
- reminders;
- lockouts;
- schedules;
- due states

deterministic in tests.

---

# 182. MONEY

Use decimal-safe representation, not binary floating point.

Store currency code.

Define rounding.

---

# 183. PERCENTAGES

Validate 0–100 where applicable.

Resource allocation may exceed 100 in aggregate but each allocation field must have sensible bounds.

---

# 184. CRITICAL PATH

Implement/test graph algorithm on acyclic task dependencies.

Reject dependency cycles.

Clarify date calculation rules.

---

# 185. GANTT BASELINE

Display:
- baseline;
- forecast;
- actual.

Do not overwrite baseline when dragging forecast unless approved rebaseline flow.

---

# 186. DATA OWNERSHIP

Historical records continue to reference deactivated owners.

New assignment UI excludes inactive users by default.

---

# 187. NOTIFICATION DEEP LINKS

Deep link to:
- project;
- action/task;
- milestone;
- gate;
- meeting;
- roadblock/CAPA.

Authorization checked on navigation.

---

# 188. ADMIN REFERENCE DATA

Configurable:
- priorities;
- project categories;
- pillars;
- readiness templates;
- notification policy;
- report templates.

Protected enums used by core invariants should not be deletable in a way that corrupts records.

---

# 189. REPORT TRENDS

Retain sufficient historical snapshots/events to show:
- RAG trend;
- milestone trend;
- roadblock aging;
- action resolution trend.

Do not fabricate historical values from current state.

---

# 190. RELEASE READINESS REPORT

`docs/execution/RELEASE_READINESS.md` must summarize:

- scope completion;
- requirement coverage;
- test counts/results;
- security review;
- performance review;
- accessibility review;
- migration/seed;
- backup/restore;
- deployment assets;
- external dependencies;
- known non-blocking limitations;
- final go/no-go.

---

# 191. AUTONOMOUS IMPLEMENTATION SUCCESS CRITERIA

The orchestrator is successful when:

1. It can start from empty repository.
2. It chooses and documents implementation decisions without routine user intervention.
3. It does not abandon required scope after building only dashboards/UI.
4. It continuously tests.
5. It fixes its own regressions.
6. It maintains traceability across context windows.
7. It leaves a reproducible repository.
8. It clearly separates external credential needs from unfinished implementation.
9. It does not claim completion prematurely.
10. The final system passes the release acceptance journeys.

---

# 192. PRODUCT SUCCESS METRICS

Once deployed, suggested product metrics:

Adoption:
- weekly active users;
- % active projects with current update;
- My Work usage;
- meeting mode usage.

Governance:
- gate lead time;
- % projects with complete Sponsor/PM/RACI;
- stale project rate;
- change-control compliance.

Execution:
- on-time milestones;
- overdue action rate;
- roadblock aging;
- CAPA effectiveness.

Reporting:
- manual deck preparation time;
- scheduled report success;
- export usage.

Data quality:
- governance exception count;
- orphaned responsibility count.

These are product-operating metrics, not release blockers unless implementation is missing.

---

# 193. FINAL PRODUCT POSITIONING

The target combines:

- modern work management usability;
- robust schedule/dependency planning;
- governance gates;
- site/enterprise access;
- live operational meetings;
- portfolio analytics;
- CAPA/risk controls;
- resource/financial management;
- automated executive reporting;
- audit/compliance;
- offline continuity.

Its differentiator is not generic task tracking.

It is an enterprise IT delivery operating system that connects:

```text
Strategy
+ Governance
+ Projects
+ Sites
+ People
+ Execution
+ Meetings
+ Risk/CAPA
+ Resources
+ Finance
+ Reporting
+ Compliance
```

in a single governed platform.

---

# 194. NORTH-STAR END-TO-END FLOW

```text
CREATE IDEA
   ↓
ASSIGN SPONSOR / PRELIMINARY OWNER
   ↓
INITIATE
   ↓
ASSIGN PM / TEAM / SITES / DIVISIONS
   ↓
PLAN WORKSTREAMS / TASKS / DEPENDENCIES / MILESTONES
   ↓
DEFINE RACI / DELIVERABLES / RISKS / RESOURCES / BUDGET
   ↓
STEERING GATE
   ↓
EXECUTE
   ↓
SYSTEM CALCULATES PROGRESS / HEALTH / EXCEPTIONS
   ↓
ROADBLOCKS / RISKS / CAPA / ACTIONS MANAGED
   ↓
WEEKLY MEETING AUTO-ASSEMBLED
   ↓
LIVE DECISIONS / ACTIONS / ESCALATIONS
   ↓
SITE READINESS / UAT / SECURITY / CHANGE
   ↓
DEPLOY
   ↓
GO LIVE
   ↓
OPERATE / STABILIZE
   ↓
HANDOVER
   ↓
MEASURE BENEFITS
   ↓
CLOSE
```

Management continuously sees:

```text
Portfolio Health
Site Health
Governance Health
Schedule Health
Resource Health
Financial Health
Risk/CAPA Health
Upcoming Decisions
Upcoming Go-Lives
```

from the same underlying records.

---

# 195. FINAL ACCEPTANCE STATEMENT

The platform is complete only when it is possible to run the application from a clean environment, seed realistic enterprise data, execute the mandatory role and lifecycle journeys, pass all authorization/confidentiality tests, generate correct reports and decks, handle concurrency/offline conflicts without silent data loss, perform backup/restore validation, and produce a green release-readiness report with no unfinished implementable requirement.

Anything less is an intermediate build, not final completion.
