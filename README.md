# Technology Risk Interview App

A local web app for one-to-one Technology Risk interviews (UK banking). It started with software developers, built from the Technology Risk Developer Interview Questionnaire, and can hold further questionnaires for other parts of the business (see **Questionnaires** below).

Installed at `C:\TechRiskInterviewApp`. This is a local folder, deliberately outside OneDrive.

## Requirements

- Windows 10 or 11
- **Node.js 22.13 or later** (LTS), from https://nodejs.org. Nothing else is needed: no `npm install` and no internet connection. The app uses only Node's built-in modules, including its built-in SQLite database.

## Start

1. Double-click **`start.bat`**. Your browser opens at http://localhost:8420.
2. Keep the server window open while you use the app. Close it (or press Ctrl+C) to stop.
3. First run: create the administrator. Then add assessors and viewers under **Admin → Users**.

Tip: right-click `start.bat` → **Show more options → Send to → Desktop (create shortcut)** to put a shortcut on your desktop.

## Features

- All 35 sections. Each questionnaire section (1-29) has an opening question, follow-up probes, the risk being assessed, the expected control, evidence to request, red flags and PRA requirements (with other UK considerations). Sections 30-35 cover red flags, findings and risk assessment, the PRA requirements mapping and other UK requirements, the interview report and the final questions.
- Per question: the interviewee's response, evidence status and a red-flag marker. Per section: a four-way comparison (what the interviewee says / what is documented / what is technically enforced / what is evidenced), the gaps between them, and a control rating. Everything autosaves.
- Findings register with inherent and residual scoring (likelihood × impact: 1-4 Low, 5-9 Medium, 10-16 High, 20-25 Critical), classification, regulatory areas (PRA first), owner, target date, risk acceptance and escalation.
- Interview report (the 13 headings in section 34), with a draft generated from the captured data.
- Printing, or "Save as PDF": blank guide, one-page checklist, interview record, report, findings register, single finding, statistics.
- Import/export: JSON backup, single-interview JSON, CSV (opens in Excel), CSV import of findings, and a database snapshot (admin only). Imports add to existing data and never overwrite.
- Statistics with filters (date, team, application), and a table view for every chart.

## Planning an interview: depth and sections

Every question is tagged **Core**, **Standard** or **Deep dive**. Choose the depth on the interview's Overview tab:

| Depth | Questions (incl. openers) | Planned time | Suits |
|---|---|---|---|
| Core | about 130 | 60 min | Lower-criticality systems or a first conversation |
| Standard | about 280 | 90 min | Most systems |
| Deep dive | all 362 | 150 min (consider two sessions) | Critical systems and important business services |

- Until you pick a depth yourself, the app follows the application criticality: Tier 1 → Deep dive, Tier 2 or unknown → Standard, Tier 3-4 → Core.
- The **Cloud** section is left out automatically for on-premises systems, and **Containers** when you answer "No" to containers. The Overview tab lets you include or leave out any section.
- In a section, **Show more questions** reveals those beyond the chosen depth. Anything already answered is always shown.
- **Print → Question sheet for this interview** prints only this interview's questions, with tick boxes. The blank guide can be printed at any depth.
- Interviews created before depth existed show every question.

## Quick answers

Each question has one-click answers alongside the notes box:
- **Yes/no questions:** Yes · Partly · No · Don't know · N/A
- **Open questions:** Clear · Vague · Don't know · N/A

Answers are read through the question. "Yes" to *"Is MFA enforced?"* is good (green), but "Yes" to *"Can developers approve their own changes?"* is a concern (red). Plain facts such as *"Does it process payments?"* are neither. The tags are in `content.js` (`concern: 'yes'` / `concern: 'none'`).

Quick answers feed the statistics ("Quick answers by section", "Questions most often answered with a concern or Don't know", and the "Don't know" rate). They also feed the report draft: concerns go under weaknesses; "Don't know", vague answers and marked questions go under further investigation.

## Meeting mode

Click **▶ Meeting mode** on any interview for a full-screen, one-question-at-a-time view in the interview's running order: included sections, at the chosen depth, then the final questions.

- **Timers** show time in the current section against its share of the planned duration, and total time against plan. Both turn red when over. They keep running if you switch to another window. Pause with **P**.
- **Come back to this (M)** marks a question. Marked questions are listed in meeting mode (**L**), on the interview page, and in the report draft.
- **Guide (G)** shows the section's risk, expected control, evidence to request and red flags.
- The end screen summarises answers, concerns, "Don't know" and marked items, with links to red flags, the checklist and the report.
- Your position is saved, so you can leave and resume later.

| Keys | Action |
|---|---|
| Ctrl+Enter / Ctrl+Shift+Enter | Next / previous question (works while typing) |
| Alt+1 … Alt+5 | Quick answer (works while typing) |
| Esc | Leave the notes box, so the single keys below work |
| → / ← | Next / previous |
| 1 … 5 | Quick answer |
| F · M · E | Red flag · Mark for later · Next evidence status |
| P · G · L · ? · Q | Pause timers · Guide · Marked list · Help · Exit |

## Evidence tracker

**Evidence** in the top menu lists every evidence item requested in any interview. This covers the section evidence lists and any question where you set an evidence status.

- Each item has a stable **reference**: `7.E1` is evidence item 1 in section 7, and `7.Q3` is the evidence for question 3.
- Change the status, due date, "requested from" and notes directly in the list.
  - Setting an item to *Requested* fills in a due date: the interview's "Evidence due by" date, or 14 days from today.
  - **Log chase today** records each chase.
  - Overdue items are highlighted, and the tiles at the top filter the list.
- **Print evidence request letter** (choose one interview in the filter, or use the interview's Print menu) produces a letter for the developer. It lists the outstanding items with references and due dates, plus guidance on what good evidence looks like and what must not be sent (secrets, unmasked customer data).
- **Export CSV** exports the list, including file fingerprints.
- The dashboard shows how much evidence is outstanding and overdue.

### Evidence files (📎)

Attach the files you receive, from the tracker or from the evidence table in the section itself.

- Each file is fingerprinted with **SHA-256** when it's uploaded.
- The fingerprint is checked on **Verify** and on every download. A file that no longer matches is refused, unless you choose "Download anyway", which is recorded in the audit log.
- Uploads, downloads and deletions are audit-logged with the fingerprint. Only admins can delete files.
- Files are limited to 25 MB each. They're stored inside the database, so **automatic backups and restores include them**. The JSON and CSV exports do not include them.
- Deleting an interview also deletes its evidence files.

## Compare interviewees

**Compare** in the top menu (or **⇄ Compare with colleagues** on an interview) puts the answers of up to 6 people side by side. Only interviews on the same questionnaire can be compared; with several questionnaires, choose one at the top. Choose a team, an application, or tick interviews.

- **Contradiction** (red): one said Yes and another said No about the team or system, e.g. *"Can developers approve their own changes?"*.
- **Partial disagreement** (amber): definite answers differ in another way, e.g. Yes vs Partly.
- **Knowledge gap** (grey): one knew and another said "Don't know", or one answer was clear and another vague.
- Questions about the individual (section 1 role and access, 24 training, 25 regulatory awareness) are shown but never flagged, because different people are expected to differ there.
- Each section row shows each developer's control rating.
- Tick **Only show contradictions, disagreements and gaps** for a focused view. **Print comparison** prints it.
- **+ Raise finding** on a flagged row creates a finding pre-filled with every developer's answer, classified as a *Potential risk* until evidence confirms it.

The comparison relies on the quick answers (Yes / No / Don't know …), so record them during interviews. A contradiction shows that the accounts disagree, not who is right: resolve it with the documented process, what the technology enforces, and the evidence.

## Finding templates and red flags

- **30 standard finding templates**, e.g. *Code changes can be approved by their author* or *Backup restoration has not been tested*. Each gives consistent wording: description, expected control, evidence to request, recommended remediation, category, regulatory areas (PRA first), the specific rules, and a suggested likelihood and impact. Browse them in **Guide & library → Finding templates**.
- **Start from a template** at the top of every finding form. Templates relevant to the current section are suggested first.
  - Applying a template fills empty fields only; you're asked before anything is replaced, and existing notes are kept.
  - Impact is raised by one for Tier 1 applications and lowered by one for Tier 3-4.
  - Findings start as *Potential risk* until evidence confirms them.
- **Red flags → findings:** tick a red flag on an interview's Red flags tab and **+ Raise finding** appears. It's pre-filled from the matching template plus the red flag's guidance: why it matters, the risk, what was said, the evidence to request, when it may become material, and the follow-up question.
- Findings remember which template they came from. The Themes report uses this to count recurring findings exactly.
- Templates live in `public\js\content.js` (`findingTemplates`, and `redFlagTemplate` for the red-flag links). Keep template IDs unchanged once in use.

## Reports

**Reports** is organised by who will read the report. All of them use the same filters (business service, questionnaire, date, team, application), and each prints, saves as PDF or downloads as Word.

**Reports for:**

- **Board of Directors** - plain English, no acronyms or technical terms: the overall position, headline figures (people interviewed, issues open, serious issues, overdue actions, issues resolved, evidence checked), what is working well, the main concerns and why they matter, what is being done, the important business services (can we recover within the agreed limit?), whether things are getting better, and the decisions or support needed.
- **Head of Compliance** - plain English, no acronyms: the regulatory obligations affected (named in plain words, with the regulator in full and what the obligation requires), issues that could breach a regulatory rule, risks the bank has formally accepted and when they expire, overdue actions, whether we can prove our controls work (evidence asked for, checked, awaited or missing, by department), the important business services, and what is working well.
- **Chief Financial Officer** - plain English (finance terms, no technical jargon or acronyms), built from the **Accounts and finance** interviews plus any finding elsewhere in the bank that affects the accounts, regulatory reports, payments or fraud (by category or regulatory area). It explains why the Chief Financial Officer needs it (personal accountability for the integrity of financial information and regulatory reporting; accounting records under the Companies Act 2006; accurate reporting to the Prudential Regulation Authority; the offence of failing to prevent fraud; external auditors' reliance on these controls), then gives: issues affecting the accounts or regulatory reports and payment and fraud issues alongside the usual measures, each assessed and explained; how each of the 13 **finance control areas** was rated and what it protects; strengths and concerns; **technology issues raised elsewhere** that could affect the figures or payments; actions with owners and dates; evidence by finance area; important services; the trend; how far to rely on the results; and matters for the Chief Financial Officer.
- **CTO - technical report** - the technical detail: open findings with references and ratings, recurring issues with their regulatory references, control areas rated weak, red flags, consistency between interviewees (contradictions and knowledge gaps), the services with their unmapped systems, and the regulatory areas and sources.
- **CTO briefing paper** - the case for change (see below).

**Every result is explained (Board and CTO reports).** Both reports now justify themselves and interpret their results:

- **Why this report has been produced** - the purpose, the reader's responsibility and the regulatory basis, how the results were obtained (interviews compared with procedures, what systems enforce and evidence), **why the results should be formally noted**, and what the reader is asked to do. The CTO version cites the PRA Fundamental Rules, SS1/21, SS2/21, SM&CR and enforcement precedent.
- **What the results mean** - every headline measure is assessed as **Good**, **Concern** or **Keep an eye on**, with *why*, and either *what it could lead to* (concerns: e.g. customer harm, data loss, regulatory action, senior managers' personal accountability) or *why it helps the business* (good results). The CTO version adds contradictions within teams, the "Don't know" rate, recurring findings and unmapped service systems.
- **Strengths say why they are good for the bank; concerns say what could happen if they are not addressed** - using plain consequences and benefits for every risk category (in content.js, `plain.impacts`).
- **Important services and trend** each end with a plain "what this means" statement.
- **CTO only: implications of every High/Critical finding** - the risk, the potential consequence, the wider business impact, the regulatory exposure and the control the regulator would expect, with owner, target and status.
- **How these results were produced, and how far to rely on them** - the method, the thresholds used to call a result good or a concern, a **confidence level** (High, Moderate or Limited, from the number of interviews, the areas covered and how much evidence has been checked) and the limitations.

The thresholds: any serious (high or critical) issue still open, any overdue fix, or any important service not shown by a test in the last year to recover within its agreed limit is a concern; three quarters or more of requested evidence checked is good and under two fifths a concern; no issues resolved in three months while issues are open is a concern. For the CTO, a "Don't know" rate above 15% or any Yes/No contradiction within a team is also a concern. With no interviews in scope, the reports say the results are not yet assessed rather than calling anything good.

**How the plain-English reports stay plain:** every finding template has a plain title and a one-sentence "why it matters" (for example *"System passwords are stored where too many people can see them - anyone who finds them could get into important systems or customer data"*), and categories, regulatory areas, classifications and regulators have plain names. The board and compliance reports only use this wording, never the technical titles. Findings written without a template appear under their plain category, so **record findings from templates where you can**. Senior manager function codes are removed from role names. Anything typed into the app that still puts an acronym into these reports (an owner such as "CIO", an approver reference, a service name) is listed in a **plain-English check** above the preview, so you can reword it before sending.

**Each report has a little wording you control**, saved for everyone: title, period covered, prepared by and date, the overall position (worked out from the data, or chosen), a summary message, and the decisions needed (board) or matters for the Head of Compliance. Demo data is excluded unless ticked.

The overall position is worked out as: *significant improvement needed* (any critical issue, or three or more serious ones), *improvement needed* (any serious or overdue issue), *generally sound, with improvements to make* (other open issues), or *sound*. "Serious" means rated high or critical. "Is it getting better?" compares open and serious issues now with three months ago.

**Working analysis** (for assessors, not for circulation as they stand):

- **Statistics** - all the charts and counts, with CSV export.
- **Themes** - what recurs across interviews: recurring findings (grouped by template), repeated red flags, weak control areas, concerning answers, and a by-team view. Word export.
- **Trends** - month by month: findings raised by rating, the open backlog, interviews held, the share of controls rated effective, and the "Don't know" rate. The app records the date a finding is closed, so the backlog is accurate.

**Per interview**, on the Report tab:
- **Executive summary:** a one-page summary for senior readers. It has an overall assessment, a headline, key figures, the top 5 risks, the control areas with their ratings, strengths and immediate actions.
  - The overall assessment is worked out from the ratings and findings. Set **Overall assessment** and **Headline** on the Report tab to use your own conclusion.
  - Print / PDF or Word.
- **Full interview report:** header, executive summary, the 13 report sections, findings, final questions and sign-off. Print / PDF or Word.

**Word (.docx) exports** are available for the interview report, executive summary, findings register (landscape, one page per finding), themes report and CTO briefing. They're generated inside the app with no add-ins or internet needed, and open in Word as ordinary editable documents with headings, tables and page numbers.

## Leadership briefing (Reports → CTO briefing)

A briefing of about 4–5 pages making the case to the CTO that PRA expectations must apply to software development, built from the programme's own evidence. It uses the same date / team / application filters as the other reports.

1. **Decision requested:** the ask, up front.
2. **Key messages:** generated from the data (interviews, open High and Critical findings, the most widespread issues, PRA areas engaged, evidence verified, contradictions, "Don't know" rate), or your own wording.
3. **Why this matters: the PRA:** Fundamental Rules, operational resilience (SS1/21), outsourcing (SS2/21), SM&CR, operational risk and capital, supervisory review and enforcement (TSB, 2022).
4. **What we found:** the most widespread issues, regulatory areas affected, top risks.
5. **Important business services:** each important business service (and candidate under review) from the register - impact tolerance, last scenario test and result, open and High/Critical findings, which questionnaires have covered it, and its main gaps - plus a key message such as *"2 of our 3 important business services have open High or Critical findings, and 1 has not been shown to stay within its impact tolerance"*. It follows the report filters (including the service filter) and the demo-data setting. Untick **Include the important business services section** to leave it out; it is also left out while the register is empty, and the sections renumber themselves.
6. **What good looks like:** each issue found, the engineering control that fixes it, and the PRA requirement it meets.
7. **What we are not proposing:** no heavyweight change boards, no paperwork for its own sake, no one-size-fits-all controls, no blame.
8. **Proposed plan:** 0–30 days (open High and Critical findings, with owners and dates), 30–90 days (fixes for recurring themes), 90–180 days (ownership, evidence by default, service mapping, the third-party register, monthly control reporting, repeat interviews).
9. **The risk of doing nothing:** skilled person review, enforcement, capital, personal accountability, operational resilience, customers.
10. **Method and limitations**, then an appendix of the interviews covered.

**Who it is for is editable:** set the **Audience** (e.g. Chief Risk Officer, Board Risk Committee), its **short form** (e.g. CRO - used for the tab, print title and Word file name), the **Title** and the **Subtitle**. The defaults are the CTO and "Software development and PRA expectations".

Edit the wording on the left and the preview updates as you type. Your wording is saved automatically for everyone (organisation, audience, title, author, date, decision, key messages, extra actions, closing note). **Interviewees are not named** unless you tick the option; this protects the openness of future interviews. **Demo data is excluded** unless ticked, and a warning appears if it's included. Print / PDF or download Word from the top of the page.

## Finding history, closure and risk acceptance

- **History:** every finding keeps a timeline of changes (who, when, and each field's old and new value), including files attached or deleted. Closing, reopening and accepting a risk are highlighted. Findings created before this version show their creation date, with detailed history from then on.
- **Closing a finding requires closure evidence**: at least 20 characters describing what was changed and what proves it, plus the name of whoever verified it. Attach proof files under **Closure evidence files**; they are fingerprinted like other evidence. The server enforces this, not just the screen.
- **Accepting a risk requires** who approved it (with the reference) and an **expiry date** in the future.
- These rules apply when the status changes. Existing closed or accepted findings are not affected, and imported findings are taken as they are.

## Dashboard worklist

The dashboard shows **My work** (switch to **Everyone** at any time):
- **Interviews to finish:** drafts and in-progress interviews you created or are named on, with the number of sections rated and questions marked "come back to this".
- **Evidence overdue:** click one to open the evidence tracker filtered to that interview.
- **Findings due this month:** target date this month or earlier, not closed or risk-accepted. Overdue items are highlighted.
- **Risk acceptances expiring** within 30 days (or already expired), for everyone. A banner at the top repeats the warning until each one is re-approved or remediated.

## Help for new users

- **? Help** in the top bar: take the tour, the guide, finding templates, and load or remove demo data.
- **? buttons** next to fields that are easy to misread (classification, inherent vs residual risk, control effectiveness, regulatory areas, finding status, risk acceptance, closure evidence, control assessment, four-way comparison, quick answers, evidence status, depth, overall assessment, templates, contradictions).
- A **guided tour** (11 short steps) starts once for each new user. Restart it from the Help menu.
- **Demo data:** three example interviews and five findings (with evidence, red flags, a contradiction between two developers, an overdue item and a risk acceptance about to expire). Everything is labelled **DEMO**, dated relative to today, and removed in one click from the Help menu or the dashboard. Real records are never affected. Demo data is included in reports while it's loaded, so remove it before real use.

## Security

- Login required. Passwords must be at least 12 characters and are hashed with scrypt.
- Accounts lock for 15 minutes after 5 failed attempts. Sessions end after 30 minutes idle.
- Roles:
  - **Admin**: everything, including users, deletion, the audit log and database snapshots.
  - **Assessor**: create and edit interviews and findings, import and export.
  - **Viewer**: read-only, including reports and printing.
- New and reset accounts must change their password at first sign-in.
- **Managing users** (Admin → Users): add users; **Edit** a user's full name, role and whether the account is active; disable or enable, unlock, reset a password, or **Delete** an account.
  - Usernames cannot be changed, because records and the audit log identify people by them. To rename someone, add a new user and disable the old one.
  - A deleted user's username can never be reused, so their records stay attributable to them. Their name stays on everything they created and in the audit log, and the deletion itself is audited.
  - You cannot change your own role, disable or delete yourself, and the last active admin cannot be demoted, disabled or deleted - so the app always has someone who can manage it.
  - Disabling or deleting a user ends their sessions immediately. Prefer **Disable** when someone leaves (it keeps the account for reference); use **Delete** for accounts created in error or no longer needed.
- The audit log records sign-ins, changes, imports and exports.
- CSRF protection and strict security headers.
- By default the app is reachable only from this computer (127.0.0.1).

## Data and backups

Data is stored in `C:\TechRiskInterviewApp\data\app.db`, created on first run.

### Automatic backups (Admin → Backups)

- By default a backup is taken **daily** into `data\backups`. If the laptop was off when one was due, it runs shortly after the app next starts.
- Each backup is integrity-checked, and its SHA-256 fingerprint is saved alongside it. The newest 30 are kept (you can change this).
- **Recommended:** change the backup folder to a USB drive or network share, e.g. `E:\TechRiskBackups`. A folder on the same disk does not protect you if the laptop is lost or the disk fails. OneDrive folders are refused.
- **Back up now** takes an immediate backup.
- The dashboard warns admins if backups are off, failing or overdue.
- **Restore** replaces all current data (interviews, findings, users and the audit log) with a chosen backup.
  - A safety copy of the current data is taken first, so a restore can be undone.
  - A backup whose fingerprint no longer matches is refused.
  - Everyone is signed out afterwards.
  - You can also restore a `.db` file from elsewhere via **Restore from another file**.
- Backup settings and history are kept in `data\backup-settings.json` and `data\backup-log.jsonl`, outside the database, so a restore never changes them.

Other ways to copy your data:
- **Import / export → Full backup (JSON)**. Importing JSON *adds* data and never replaces it.
- Or stop the app and copy `data\app.db`.

To keep the data in a different local folder, run:
`node --disable-warning=ExperimentalWarning server.js --data "D:\TechRiskData"`

Exports may contain confidential information. Handle them in line with your data-handling policy.

Optional: to allow network access, `set HOST=0.0.0.0` before `start.bat`. The app then runs over plain HTTP, so do this only on a trusted network. To change the port, `set PORT=9000` first.

## Forgotten admin password

Another admin can reset it under **Admin → Users**. If there is no other admin, stop the app and move `data\app.db` aside to start fresh. Restore your work from a JSON backup via **Import / export**.

## Regulatory content

Regulatory notes are summaries as understood in September 2026. They are not legal advice. Verify against the official sources listed under **Guide & library → Authoritative sources**. Edit `public\js\content.js` to match your bank's policies, risk taxonomy and scales.

### Focus on the PRA

The bank is UK-only, so the app concentrates on the **Prudential Regulation Authority**, the bank's prudential regulator, whose rules apply to it directly. EU DORA is not used anywhere.

- **Section guides** show a **PRA requirement** for every section first: the relevant Fundamental Rules, PRA Rulebook Parts, SS1/21 (operational resilience), SS2/21 (outsourcing and cloud) or SM&CR. Below that, a short **Also relevant (FCA, ICO, NCSC)** note appears only where those genuinely apply.
- **Library → 32. PRA requirements mapping** explains what each PRA requirement means for software development, the evidence the PRA would expect, and which interview sections test it. It covers the Fundamental Rules, operational resilience, outsourcing and third parties, critical third parties, SM&CR, notifications, operational risk and capital (ICAAP / Pillar 2A), cyber resilience (CBEST), whistleblowing, and supervisory review and enforcement, including the 2022 TSB fine. **33. Other UK requirements** covers the FCA (including the Consumer Duty), the ICO and NCSC as supporting context.
- **Findings** have a **Regulatory areas - PRA first** checklist. Six PRA areas come first:
  - Operational resilience
  - Outsourcing & third parties
  - Accountability (SM&CR)
  - Systems & controls
  - Notifications & incident reporting
  - Record keeping & auditability

  They're followed by Consumer Duty (FCA) and Data protection (ICO). Each area is tagged with its regulator. Templates, questions and comparisons tick the usual areas, and every template's wording names a PRA rule. Record the precise rule under **Specific rules**.
- **Reports:** the statistics show "Findings by regulatory area (PRA first)". The **Themes** report and its Word version include **Regulatory areas affected** across the programme. The executive summary lists the regulatory areas affected, with their regulator.
- **Section 25** is now **Developer awareness of PRA expectations**. The DORA questions (s25-q1 to s25-q3) are retired, so they still show wherever an old interview answered them. New questions cover PRA awareness, important business services and impact tolerances, training, and the accountable senior manager (s25-q8 to s25-q11). The questionnaire version is **2026.4**.
- Any DORA fields in findings saved before this change are removed the next time the finding is saved, and are not recorded as a change in its history.
- **FCA Consumer Duty** (PRIN 2A, in force from 31 July 2023) remains as supporting context where technology failure harms customers. Section 2 includes the customer-outcomes question **s2-q16**.

## Editing the questionnaire safely (permanent question IDs)

Answers are saved against a permanent ID on every question (`s7-q1`) and evidence item (`s7-e1`), not against its position. That means you can reorder, reword and add questions without answers moving to the wrong question. The rules:

1. **Never change or reuse an ID.**
2. **Never delete an item.** Add `retired: true` instead. Retired items disappear from new interviews but still show wherever they were answered.
3. **To add an item**, use the next unused number in that section (e.g. `s7-q13`), in any position.
4. **Rewording is fine.** If the *meaning* changes, retire the old item and add a new ID.
5. **Bump `QUESTIONNAIRE_VERSION`** at the top of `content.js`. Each interview records the version it was started on.

Example:
```js
{ id: 's7-q4', q: 'Where are certificates stored?', retired: true },
{ id: 's7-q13', q: 'How are certificate expiry dates monitored and alerted?', fu: ['Who receives the alert?'] },
```

The server checks these rules each time it starts, using `question-ids.lock.json` (keep this file with the app):
- A duplicated or malformed ID **stops** the server with an explanation.
- A deleted ID produces a warning. Answers saved against it are never discarded; they appear under "Answers to questions no longer in the questionnaire".

Interviews saved before permanent IDs existed are upgraded automatically at start-up, after a safety backup (`tech-risk-pre-migration-….db`).

## Important business services (Services)

The **Services** menu holds the register of the bank's business services, built around PRA SS1/21. For each service you record:

- name, description, who receives it, and its **designation** (important business service, candidate under review, or not important)
- the business owner and the **accountable senior manager** (e.g. SMF24), and the regulators
- the **impact tolerance** (wording, maximum tolerable disruption in hours, and other measures)
- the **mapping** - people and teams, processes, technology, suppliers, facilities, information and data (one per line)
- the last **scenario test** and its result against the tolerance, known vulnerabilities, the self-assessment reference, review date and approver

**Linking:** tick the services an interview covers on its Overview (*Linked to services in the register*), and the services a finding affects on the finding form. A new finding inherits its interview's services.

**Each service page** brings together what the programme knows about it: a health summary (owner and accountable senior manager recorded, tolerance set, tested within 12 months and within tolerance, mapping complete, reviewed within 12 months, open High/Critical findings, and whether Software development, Technology operations and Information security interviews are linked), coverage by questionnaire, **mapped systems not named on any linked interview**, open findings, control areas rated weak, red flags heard and evidence outstanding. Print / PDF a single service or the whole register; export it as CSV.

**Elsewhere:** Reports and the findings register can be filtered by service (*Reports for this service* on a service page); the dashboard shows how many important business services are untested, out of date or breached; JSON export/import and backups include the register (links are remapped on import); demo data includes two demo services. Deleting a service (admin) removes its links but keeps the interviews and findings.

## Questionnaires

The app holds five questionnaires, and more can be added:

- **Software development** - the original developer interview (29 sections).
- **Human resources** - Technology Risk interviewing HR about the people controls that technology and regulatory controls depend on (14 sections, 110 questions): HR role; pre-employment screening; joiners, movers and leavers; SM&CR, certification and conduct rules; fitness, propriety and regulatory references; training; key people and succession; contractors; HR systems and employee data; HR and payroll suppliers; whistleblowing; conduct, disciplinary and insider risk; reward and objectives; HR governance and records. It has its own 14 red flags, checklist, report sections, final questions and 11 finding templates (e.g. *Leavers and movers are not notified promptly to Technology*, *Incentives reward delivery without regard to risk and control*). Its interview details ask about HR processes and populations instead of deployment model and containers. It adds the **People risk** category, the **Whistleblowing** and **Remuneration** regulatory areas, and two PRA mapping rows (fitness and propriety / references; remuneration).

- **Accounts and finance** - Technology Risk interviewing the finance team about the systems, data and payment controls behind the accounts and regulatory returns (13 sections, 94 questions): finance role; finance systems and data flows; access and segregation of duties; journals and manual adjustments; data feeds, interfaces and reconciliations; spreadsheets and end-user computing; change management for finance systems; supplier payments and payment controls; financial close and statutory reporting; regulatory reporting; finance suppliers and resilience; fraud and financial crime; records, audit trail and evidence. It has 13 red flags (e.g. *"We change bank details when the supplier emails us"*), its own checklist, report sections and final questions, and 10 finding templates (e.g. *Supplier bank detail changes are not independently verified*, *Regulatory returns rely on undocumented or uncontrolled data*). It adds the **Financial and regulatory reporting** and **Fraud and financial crime** categories, the **Regulatory reporting** and **Financial crime & fraud** regulatory areas, and a PRA mapping row for regulatory reporting.
- **Technology operations and cloud platform** - the teams that run infrastructure, cloud and production services (14 sections, 96 questions): role; asset inventory and service mapping; cloud governance and infrastructure as code; cloud provider and shared responsibility; privileged access; infrastructure change; monitoring and capacity; incident and problem management; backup and recovery; disaster recovery and impact tolerances; patching and obsolescence; containers; managed service suppliers; runbooks, records and MI. The two cloud sections are left out automatically for on-premises estates, and the container section when containers are not used (the assessor can override). 13 red flags and 9 new templates.
- **Information security** - the security function (13 sections, 82 questions): role, authority and resourcing; governance, risk appetite and board reporting; critical assets and attack surface; identity and access; vulnerability management; monitoring and detection; incident response; security testing (including CBEST / STAR-FS); secure development (compare with the developer interviews - gaps between what security believes is enforced and what developers describe are findings); cloud, infrastructure and data security; supplier security; awareness and threat intelligence; metrics and evidence. 14 red flags and 9 new templates.

Operations and security overlap with the developer questionnaire, so their sections also **reuse existing templates** (for example *Backup restoration has not been tested*): each section can name the templates suggested first on a finding raised from it, from any questionnaire (`templates: [...]` in content.js). The Themes report then counts the same issue the same way whichever team raised it.

At standard depth an HR interview has about 100 questions, a finance interview about 88, operations about 94 and security about 82, so use **Core** (about 55) for a first conversation or split a deep dive across sessions. Each interview uses exactly one questionnaire, chosen when it is created, and it can never be changed afterwards (answers are stored against that questionnaire's question IDs).

- With only one questionnaire, as now, nothing extra appears on screen.
- With more than one: **New interview** asks which to use; the interviews list, reports, evidence tracker and library get a questionnaire choice; interviews show a questionnaire tag.
- Interviews saved before this change were assigned to **Software development** automatically at start-up, after a safety backup. Nothing else about them changed.
- Screens and exports say **Interviewee** rather than Developer, except where a questionnaire's own wording applies (the Software development guide still talks about developers).
- Reports combine questionnaires or show one. Sections from questionnaires other than Software development are labelled with the questionnaire's title (e.g. *Technology operations - 3. Monitoring*), so section numbers are never ambiguous. Checklist completion is measured within each questionnaire.

**Adding a questionnaire** (in `public\js\content.js`, the `questionnaires` list at the end): give it a short lower-case `id` (e.g. `ops`) and prefix **every** ID in it with that id: sections `ops-s1`, questions `ops-s1-q1`, evidence `ops-s1-e1`, red flags `ops-rf1`. Software development keeps its original unprefixed IDs. The server refuses to start if an ID is unprefixed or used twice, so an ID can never mean two different things. Each questionnaire has its own sections, red flags, checklist, report sections and final questions; its sections list their own regulatory areas (`ukAreas`, `praAreas`). The same permanent-ID rules above apply.

## Files

```
start.bat            Windows launcher
server.js            Local web server, API, database, authentication
public\index.html    App shell
public\css\app.css   Styles (screen, print, dark mode)
public\js\content.js Questionnaire, red flags, PRA and other UK mappings (editable)
public\js\*.js       App screens
public\js\backup.js  Admin backup and restore screen
public\js\meeting.js Meeting mode
public\js\evidence.js Evidence tracker, request letter, evidence files
public\js\compare.js Compare interviewees
public\js\insights.js Executive summary, themes and trends
public\js\docx.js    Word (.docx) writer and exports
public\js\help.js    Help texts, guided tour, welcome card
public\js\demo.js    Demonstration data
public\js\briefing.js Leadership briefing (CTO by default)
public\js\services.js Important business services register
public\js\audience.js Board, compliance and CTO reports (plain-English wording lives in content.js)
question-ids.lock.json  Record of every question ID ever issued (keep with the app)
data\app.db          Your data (created on first run)
data\backups\        Automatic backups (default location - change in Admin → Backups)
```
