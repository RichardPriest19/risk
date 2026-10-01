// Reference library and printable documents.
'use strict';

// ---------- library ----------
// The library shows one questionnaire at a time (chosen at the top when there are several). Numbers follow that
// questionnaire's original guide, where it has one (libNos).
const libQn = () => T.qnById(getPref('libQn', T.DEFAULT_QN)) || T.qnById(T.DEFAULT_QN);
const LIB_NOS = { dev: { redflags: '30', risk: '31', pra: '32', uk: '33', output: '34-35' } };
const libNo = (k, q = libQn()) => (LIB_NOS[q.id]?.[k] ? LIB_NOS[q.id][k] + '. ' : '');
const libPages = (q = libQn()) => [
  ['guide', 'How to use this guide'], ['questions', `Question bank (sections 1-${q.sections.length})`], ['redflags', libNo('redflags', q) + 'Red flags'], ['risk', libNo('risk', q) + 'Risk assessment framework'],
  ['templates', 'Finding templates'], ['pra', libNo('pra', q) + 'PRA requirements mapping'], ['uk', libNo('uk', q) + 'Other UK requirements (FCA, ICO, NCSC)'], ['output', libNo('output', q) + 'Interview output and final questions'], ['golden', 'Golden rule'], ['sources', 'Authoritative sources'],
];
// "Print blank interview guide" menu; one group per questionnaire when there are several.
function blankGuideMenu(label = 'Print blank interview guide') {
  const grp = (q) => `${MULTI_QN ? `<span class="menu-head">${esc(q.title)}</span>` : ''}<a href="#/print/guide-core?qn=${q.id}">Core questions only</a><a href="#/print/guide-standard?qn=${q.id}">Standard</a><a href="#/print/guide?qn=${q.id}">Deep dive - every question</a><a href="#/print/checklist?qn=${q.id}">One-page checklist</a>`;
  return `<details class="menu"><summary class="btn">${esc(label)}</summary><div class="menu-list">${T.questionnaires.map(grp).join('')}</div></details>`;
}
function viewLibrary(page) {
  setActiveNav('library');
  const Q = libQn(), subj = Q.subject, subjs = Q.subjects;
  const body = {
    guide: () => `<h2>How to use this guide</h2>
      <p>You are interviewing individual ${esc(subjs)} from the perspective of Technology Risk, Information Security, Operational Resilience and Regulatory Compliance. The aim is not to catch ${esc(subjs)} out, but to understand what they actually do, identify technology risks, determine whether appropriate controls exist, and establish what evidence demonstrates that those controls operate effectively.</p>
      <h3>The five fundamental questions</h3>
      <ol><li>What does the ${esc(subj)} actually do?</li><li>What technology and security risks exist within their work?</li><li>What controls are supposed to prevent or detect those risks?</li><li>Are those controls actually operating in practice?</li><li>What evidence exists to demonstrate that the controls operate effectively?</li></ol>
      <h3>The four views to compare</h3>
      <ul>${T.fourWay.map(([, l]) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p>Each questionnaire section in an interview has a four-way comparison box and a “gaps identified” box. Gaps between these views are the most useful output of the interview.</p>
      <h3>Structure of each section</h3>
      <p>Primary (opening) question → follow-up questions → risk being assessed → expected control → evidence to request → potential red flags → relevant regulatory consideration.</p>
      <h3>Drilling down on vague answers</h3>
      <div class="dialogue"><p><strong>Interviewee:</strong> “We run security checks before deployment.”</p>
      <p><strong>You:</strong> “What security checks are performed?” → “Are those checks automated or manual?” → “Who reviews the results?” → “What happens if a vulnerability is identified?” → “Can you show me an example of the evidence from a recent deployment?”</p></div>
      <h3>Proportionality</h3>
      <p>Do not assume every requirement applies identically to every ${esc(subj)} or application. Requirements depend on the system's criticality, business service, data handled, architecture, technology, deployment model and risk classification. ${esc(T.APPLIES)}</p>
      <h3>Running an interview in this app</h3>
      <ol><li>Create an interview${MULTI_QN ? ' (choosing its questionnaire)' : ''} and complete the details on the Overview tab (criticality and the important business service calibrate the rest).</li>
      <li>Work through the sections in order, or jump around as the conversation flows. Answers save automatically.</li>
      <li>Record evidence status for each question and for each evidence item; flag concerning answers.</li>
      <li>Raise findings directly from a question or section - they are pre-filled with the category, the PRA and other regulatory areas, and regulatory notes.</li>
      <li>Tick red flags heard, ask the final questions, complete the checklist, then generate and edit the report.</li>
      <li>Print the report and checklist, or export to JSON/CSV.</li></ol>
      <p class="row">${blankGuideMenu()}</p>`,
    questions: () => `<h2>Question bank</h2><p class="intro">All question sections with their guidance. Use this to prepare, or print the blank guide to take into the meeting.</p>
      ${Q.sections.map((s) => `<details class="lib-sec"><summary><strong>${s.no}. ${esc(s.title)}</strong>${s.optional ? ' <small>(where applicable)</small>' : ''}</summary>${sectionGuideHtml(s)}</details>`).join('')}`,
    redflags: () => `<h2>${libNo('redflags') ? 'Section ' + libNo('redflags').replace('. ', ': ') : ''}Red flags</h2><p class="intro">Answers that should trigger further investigation. For each: why it matters, the risk, the follow-up, the evidence to request, the control that should normally exist, and when it may become a material technology risk.</p>
      ${Q.redFlags.map((f) => `<div class="card rf-lib"><h3>“${esc(f.quote)}”</h3>${redFlagGuide(f)}</div>`).join('')}`,
    risk: () => `<h2>${libNo('risk') ? 'Section ' + libNo('risk').replace('. ', ': ') : ''}Risk assessment framework</h2>
      <p>For each finding capture: finding ID, application/system, interviewee/team, risk category, description, evidence, existing control, control effectiveness, likelihood, impact, inherent risk, residual risk, regulatory relevance, PRA and other regulatory areas, security relevance, operational resilience relevance, recommended remediation, control owner, target date, risk acceptance requirement and escalation requirement. The finding form in this app contains all of these.</p>
      <h3>Do not treat every weakness as a regulatory breach</h3>
      <table class="table"><thead><tr><th>Classification</th><th>Meaning</th></tr></thead><tbody>${T.classifications.map((c) => `<tr><td><strong>${esc(c.id)}</strong></td><td>${esc(c.desc)}</td></tr>`).join('')}</tbody></table>
      <h3>Scoring</h3>
      <p>Risk score = likelihood (1-5) × impact (1-5). Ratings: 1-4 Low, 5-9 Medium, 10-16 High, 20-25 Critical. Inherent risk is assessed before existing controls; residual risk after existing controls. Align the scales to the bank's own risk taxonomy where it differs.</p>
      <div class="grid-2"><table class="table"><thead><tr><th>Likelihood</th></tr></thead><tbody>${T.likelihood.map(([n, l]) => `<tr><td>${n} - ${esc(l)}</td></tr>`).join('')}</tbody></table>
      <table class="table"><thead><tr><th>Impact</th></tr></thead><tbody>${T.impact.map(([n, l]) => `<tr><td>${n} - ${esc(l)}</td></tr>`).join('')}</tbody></table></div>
      <h3>Escalation</h3><p>Material risks, findings rated High or Critical, and any finding where risk acceptance is sought beyond the approver's authority should be escalated in line with the bank's risk management framework.</p>`,
    pra: () => `<h2>${libNo('pra') ? 'Section ' + libNo('pra').replace('. ', ': ') : ''}PRA requirements mapping</h2>
      <div class="notice"><p>The Prudential Regulation Authority (part of the Bank of England) is the bank's prudential regulator. Its rules and supervisory statements apply directly to a PRA-authorised UK bank. This table shows what each requirement means for software development and where the interview tests it. Verify the current position with the PRA before relying on specific references - some policy (for example operational incident reporting) has been changing.</p></div>
      <table class="table"><thead><tr><th>PRA requirement</th><th>Source</th><th>What it means for software development</th><th>Evidence the PRA would expect</th><th>Interview sections</th></tr></thead><tbody>
      ${T.praMap.filter((d) => Q.id !== T.DEFAULT_QN || d.sections.length).map((d) => `<tr><td><strong>${esc(d.area)}</strong></td><td>${esc(d.source)}</td><td>${esc(d.means)}</td><td>${esc(d.evidence)}</td><td>${(Q.id === T.DEFAULT_QN ? d.sections : Q.sections.filter((x) => (x.praAreas || []).includes(d.area)).map((x) => x.no)).map((n) => `<a href="#/library/questions">${n}</a>`).join(', ') || '-'}</td></tr>`).join('')}</tbody></table>`,
    uk: () => `<h2>${libNo('uk') ? 'Section ' + libNo('uk').replace('. ', ': ') : ''}Other UK requirements (FCA, ICO, NCSC)</h2>
      <div class="notice"><p>As a dual-regulated bank, the FCA's conduct rules (including the Consumer Duty) and UK data protection law (ICO) also apply; NCSC guidance is authoritative good practice. These support the PRA case rather than replace it.</p></div>
      <table class="table"><thead><tr><th>Area</th><th>Source</th><th>Nature</th><th>Summary</th><th>Relationship to PRA requirements</th><th>Sections</th></tr></thead><tbody>
      ${T.ukMap.map((u) => `<tr><td><strong>${esc(u.area)}</strong></td><td>${esc(u.source)}</td><td>${esc(u.type)}</td><td>${esc(u.summary)}</td><td>${esc(u.overlap)}</td><td>${Q.id === T.DEFAULT_QN ? u.sections.join(', ') : '-'}</td></tr>`).join('')}</tbody></table>`,
    output: () => `<h2>${Q.id === 'dev' ? 'Section 34: ' : ''}Interview output</h2><p>After each interview, produce a structured report containing:</p>
      <ol>${Q.reportSections.map(([, l, d]) => `<li><strong>${esc(l)}</strong> - ${esc(d)}</li>`).join('')}</ol>
      <p>The Report tab of each interview can generate a first draft from your answers, ratings, evidence and findings.</p>
      <h2>${Q.finalNo ? `Section ${Q.finalNo}: ` : ''}Final questions</h2><p>Always finish the interview by asking:</p><ol>${Q.finalQuestions.map((q) => `<li>“${esc(q)}”</li>`).join('')}</ol>`,
    golden: () => goldenHtml(),
    templates: () => `<h2>Finding templates</h2>
      <p class="intro">Standard wording for findings that come up again and again, so different assessors describe the same issue the same way and the Themes report can count them. Apply a template from the finding form, or from a red flag you heard. Likelihood and impact are suggested starting points; impact is raised by one for Tier 1 applications and lowered by one for Tier 3-4. Always adjust to the evidence.</p>
      <p class="hint">Templates are defined in <code>public\\js\\content.js</code> (findingTemplates). Keep their IDs unchanged once in use.</p>
      ${(() => { const used = new Set(Q.sections.flatMap((s) => s.templates || [])); const mine = [...T.findingTemplates.filter((t) => t.qn === Q.id), ...T.findingTemplates.filter((t) => t.qn !== Q.id && used.has(t.id))]; return [...mine, ...T.findingTemplates.filter((t) => !mine.includes(t))]; })().map((t) => `<details class="lib-sec"><summary><strong>${esc(t.title)}</strong> <span class="hint">· ${esc(t.category)} · ${t.qn === Q.id ? '' : esc(T.qnById(t.qn).title) + ' '}sections ${t.sections.join(', ')} · suggested L${t.L} × I${t.I}</span></summary>
        <dl class="guide-dl"><dt>Description</dt><dd>${esc(t.description)}</dd><dt>Expected control</dt><dd>${esc(t.control)}</dd><dt>Evidence to request</dt><dd>${esc(t.evidence)}</dd>
        <dt>Recommended remediation</dt><dd>${esc(t.remediation)}</dd><dt>Regulatory areas</dt><dd>${esc(t.ukAreas.join(', '))}</dd><dt>Specific rules</dt><dd>${esc(t.uk)}</dd>
        <dt>Red flags</dt><dd>${esc(Q.redFlags.filter((f) => T.redFlagTemplate[f.id] === t.id).map((f) => `“${f.quote}”`).join(' ') || '-')}</dd></dl>
        ${canEdit() ? `<button type="button" class="btn btn-small" data-use-tpl="${t.id}">Start a finding from this template</button>` : ''}</details>`).join('')}`,
    sources: () => `<h2>Authoritative sources</h2><p>Use official sources rather than commercial compliance websites. Check each for updates before relying on it.</p>
      <table class="table"><thead><tr><th>Source</th><th>Publisher</th></tr></thead><tbody>${T.sources.map(([s, p]) => `<tr><td>${esc(s)}</td><td>${esc(p)}</td></tr>`).join('')}</tbody></table>
      <p class="hint">Content prepared September 2026. Regulatory references are summaries to support interviews, not legal advice.</p>`,
  }[page];
  if (!body) { location.hash = '#/library'; return; }
  view().innerHTML = `<div class="page-head"><h1>Guide and reference library</h1>${MULTI_QN ? `<label class="inline">Questionnaire <select id="libQn">${options(T.questionnaires.map((q) => [q.id, q.title]), Q.id)}</select></label>` : ''}</div>
    <div class="lib"><nav class="lib-nav">${libPages().map(([k, l]) => `<a href="#/library/${k}" class="${k === page ? 'active' : ''}">${esc(l)}</a>`).join('')}</nav>
    <div class="card lib-body">${body()}</div></div>`;
  const lq = $('#libQn'); if (lq) lq.onchange = () => { setPref('libQn', lq.value); viewLibrary(page); };
  $$('[data-use-tpl]').forEach((b) => { b.onclick = () => { state.findingPrefill = templateValues(templateById(b.dataset.useTpl)); location.hash = '#/finding/new'; }; });
}
function sectionGuideHtml(s, forPrint, depth) {
  const lvl = (x) => `<span class="lvl lvl-${x.level}">${esc(T.depths.find((d) => d.id === x.level).label)}</span>`;
  const boxes = (x) => (forPrint ? `<div class="qa-boxes">${T.quickAnswers[x.type].map((a) => `☐ ${esc(a)}`).join('&nbsp;&nbsp; ')}</div>` : '');
  const q = (x, n) => `<li><span class="q-no">${n}</span> ${esc(x.q)} ${lvl(x)}${x.fu.length ? `<ul class="probes">${x.fu.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}${boxes(x)}${forPrint ? '<div class="write-lines"></div>' : ''}</li>`;
  return `<p class="intro">${esc(s.intro)}</p>
    <h4>Opening question</h4><ul class="qlist">${q(s.opener, '★')}</ul>
    <h4>Detailed questions</h4><ul class="qlist">${s.questions.filter((x) => !x.retired && inDepth(x, depth)).map((x, i) => q(x, `${s.no}.${i + 1}`)).join('')}</ul>
    ${s.talkingPoints ? `<h4>Explain to the ${esc(T.qnById(s.qn).subject)}</h4><ul>${s.talkingPoints.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <dl class="guide-dl"><dt>Risk being assessed</dt><dd>${esc(s.risk)}</dd><dt>Expected control</dt><dd>${esc(s.control)}</dd>
    <dt>Evidence to request</dt><dd><ul class="${forPrint ? 'boxes' : ''}">${s.evidence.filter((e) => !e.retired).map((e) => `<li>${forPrint ? '☐ ' : ''}${esc(e.text)}</li>`).join('')}</ul></dd>
    <dt>Potential red flags</dt><dd><ul>${s.redFlags.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></dd>
    <dt>PRA requirement</dt><dd>${esc(s.reg.pra)}</dd><dt>Also relevant (FCA, ICO, NCSC)</dt><dd>${esc(s.reg.also)}</dd></dl>`;
}
const goldenHtml = () => `<section class="golden"><h2>The Technology Risk Specialist's Golden Rule</h2><p>${esc(T.goldenRule.text)}</p><blockquote>“${esc(T.goldenRule.quote)}”</blockquote></section>`;

// ---------- print views ----------
function printFrame(title, inner, back, word) {
  view().innerHTML = `<div class="print-toolbar no-print"><a class="btn" href="${back}">← Back</a><button class="btn btn-primary" id="doPrint">Print / save as PDF</button>
    ${word ? '<button class="btn" id="doWord">Download Word (.docx)</button>' : ''}
    <span class="hint">Tip: choose “Save as PDF” as the printer to create a PDF file.</span></div>
    <article class="doc">${inner}<footer class="doc-foot">${esc(title)} · printed ${fmtDateTime(new Date().toISOString())} by ${esc(state.user.fullName)} · CONFIDENTIAL</footer></article>`;
  document.title = title;
  $('#doPrint').onclick = () => window.print();
  if (word) $('#doWord').onclick = () => word().then(() => toast('Word document downloaded.')).catch(fail);
  window.addEventListener('hashchange', () => { document.title = 'Technology Risk Interview'; }, { once: true });
}
function checklistHtml(iv, q = qnOf(iv)) {
  const ck = iv ? iv.data.checklist || {} : {};
  const h = iv ? iv.data.header || {} : {};
  const field = (l, v) => `<div class="pf"><span>${esc(l)}</span><span class="pf-line">${esc(v || '')}</span></div>`;
  return `<section class="one-page"><h1>${esc(q.guideTitle || 'Technology Risk Interview')} - Checklist</h1>
    <div class="pf-grid">${field('Interviewee', h.developerName)}${field('Team', h.team)}${field('Applications', h.applications)}${field('Date', h.date)}${field('Interviewer', h.interviewer)}${field('Reference', iv ? iv.ref : '')}</div>
    <ul class="print-checklist">${q.checklist.map(([k, l]) => `<li><span class="box">${ck[k] ? '☑' : '☐'}</span> ${esc(l)}</li>`).join('')}</ul>
    <div class="pf-notes"><strong>Notes</strong><div class="notes-box">${nl2br(iv ? iv.data.checklistNotes : '')}</div></div>
    <p class="final-q"><strong>Always finish with:</strong> ${q.finalQuestions.map((q) => `“${esc(q)}”`).join(' then ')}</p>
    <blockquote class="golden-mini">Golden rule: “${esc(T.goldenRule.quote)}”</blockquote></section>`;
}
function headerTable(iv) {
  const h = iv.data.header || {};
  const rows = [['Reference', iv.ref], ['Questionnaire', `${qnOf(iv).title} (version ${iv.data.questionnaireVersion || 'not recorded'})`], ['Depth', (T.depths.find((x) => x.id === depthOf(iv.data)) || {}).label], ['Status', iv.status], ['Interviewee', h.developerName], ['Role', h.developerRole], ['Team', h.team], ['Line manager', h.lineManager], ['Applications', h.applications], ['Business service(s)', h.businessService], ['Criticality', h.criticality], ['Data classification', h.dataClassification], ['Deployment model', h.deploymentModel], ['Interviewer', h.interviewer], ['Date', h.date], ['Location', h.location], ['Others present', h.attendees]];
  return `<table class="kv-table">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '')}</td></tr>`).join('')}</table>`;
}
function printFindingsTable(fs) {
  if (!fs.length) return '<p>No findings recorded.</p>';
  return `<table class="table print-table"><thead><tr><th>Ref</th><th>Title</th><th>Category</th><th>Classification</th><th>Inherent</th><th>Residual</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead><tbody>
    ${fs.map((f) => { const s = findingScores(f); return `<tr><td>${esc(f.ref)}</td><td>${esc(f.title)}</td><td>${esc(f.category)}</td><td>${esc(f.classification)}</td><td>${s.inhR ? `${s.inhR} (${s.inh})` : ''}</td><td>${s.resR ? `${s.resR} (${s.res})` : ''}</td><td>${esc(f.controlOwner)}</td><td>${esc(f.targetDate)}</td><td>${esc(f.status)}</td></tr>`; }).join('')}</tbody></table>`;
}
function findingDetailHtml(f, ivRef) {
  const s = findingScores(f);
  const rows = [['Finding ID', f.ref], ['Interview', ivRef], ['Application/system', f.application], ['Interviewee/team', f.developerTeam], ['Risk category', f.category], ['Description', f.description], ['Evidence', f.evidence], ['Existing control', f.existingControl], ['Control effectiveness', f.controlEffectiveness],
    ['Likelihood × impact (inherent)', f.likelihood && f.impact ? `${f.likelihood} × ${f.impact}` : ''], ['Inherent risk', s.inhR ? `${s.inhR} (${s.inh})` : ''], ['Likelihood × impact (residual)', f.residualLikelihood && f.residualImpact ? `${f.residualLikelihood} × ${f.residualImpact}` : ''], ['Residual risk', s.resR ? `${s.resR} (${s.res})` : ''],
    ['Classification', f.classification], ['Regulatory areas', findingUkAreas(f).map((a) => `${a} (${areaRegulator(a)})`).join(', ')], ['Specific rules', f.ukRelevance], ['Regulatory relevance', f.regulatoryRelevance], ['Security relevance', f.securityRelevance], ['Operational resilience relevance', f.opresRelevance],
    ['Recommended remediation', f.remediation], ['Control owner', f.controlOwner], ['Target date', f.targetDate], ['Risk acceptance required', f.riskAcceptance], ['Risk acceptance reference', f.riskAcceptanceRef], ['Risk acceptance expires', f.riskAcceptanceExpiry], ['Escalation required', f.escalation], ['Escalated to', f.escalatedTo],
    ['Status', `${f.status || ''}${f.closedAt ? ` (closed ${fmtDate(f.closedAt)})` : ''}`], ['Closure evidence', f.closureEvidence], ['Closure verified by', f.closureVerifiedBy], ['Progress notes', f.progressNotes]];
  return `<h2>${esc(f.ref)} - ${esc(f.title)}</h2><table class="kv-table">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${nl2br(v || '')}</td></tr>`).join('')}</table>`;
}

async function viewPrint(kind, id, qnId) {
  setActiveNav('');
  const blankQn = T.qnById(qnId) || libQn(); // questionnaire for blank documents
  const loadIv = async () => { if (state.iv && state.iv.id === id) { await flushSave(); return state.iv; } return api('GET', `/api/interviews/${id}`); };
  if (kind === 'guide' || kind === 'guide-core' || kind === 'guide-standard' || kind === 'ivguide') {
    // Blank guide at a chosen depth, or a question sheet tailored to one interview's depth and included sections.
    const iv = kind === 'ivguide' ? await loadIv() : null;
    const depth = iv ? depthOf(iv.data) : kind === 'guide-core' ? 'core' : kind === 'guide-standard' ? 'standard' : 'deep';
    const dl = T.depths.find((d) => d.id === depth);
    const Q = iv ? qnOf(iv) : blankQn;
    const secs = iv ? Q.sections.filter((s) => sectionIncluded(s, iv.data)) : Q.sections;
    const h = iv ? iv.data.header : {};
    const title = iv ? `Question sheet ${iv.ref}` : `${Q.guideTitle} Guide - ${dl.label}`;
    printFrame(title, `
      <header class="doc-head"><h1>${esc(Q.guideTitle)} ${iv ? 'Question Sheet' : 'Guide'}</h1><p>UK banking · ${esc(Q.title)} · one-to-one interview · <strong>${esc(dl.label)} depth</strong> (about ${Number(h.plannedMinutes) || dl.minutes} minutes)${iv ? ` · ${esc(iv.ref)}` : ''}</p>
      <div class="pf-grid">${[['Interviewee', h.developerName], ['Team', h.team], ['Applications', h.applications], ['Date', h.date], ['Interviewer', h.interviewer]].map(([l, v]) => `<div class="pf"><span>${l}</span><span class="pf-line">${esc(v || '')}</span></div>`).join('')}</div></header>
      <section><h2>Purpose</h2><p>Establish what the ${esc(Q.subject)} actually does, what risks exist, what controls should prevent or detect them, whether those controls operate in practice, and what evidence demonstrates it. Compare what is said, documented, enforced and evidenced. ${esc(T.APPLIES)}</p>
        ${iv && secs.length < Q.sections.length ? `<p class="hint">Sections left out of this interview: ${Q.sections.filter((s) => !secs.includes(s)).map((s) => `${s.no}. ${esc(s.title)} (${esc(exclusionReason(s, iv.data))})`).join('; ')}.</p>` : ''}</section>
      ${secs.map((s) => `<section class="print-sec"><h2>${s.no}. ${esc(s.title)}${s.optional && !iv ? ' <small>(where applicable - ☐ N/A)</small>' : ''}</h2>${sectionGuideHtml(s, true, depth)}
        <p class="rate-line">Assessment: ☐ Effective ☐ Partially effective ☐ Ineffective ☐ Not applicable</p></section>`).join('')}
      <section class="print-sec"><h2>${Q.redFlagsNo ? Q.redFlagsNo + '. ' : ''}Red flags heard</h2><ul class="boxes">${Q.redFlags.map((f) => `<li>☐ “${esc(f.quote)}” - <em>ask:</em> ${esc(f.followUp)}</li>`).join('')}</ul></section>
      <section class="print-sec"><h2>${Q.finalNo ? Q.finalNo + '. ' : ''}Final questions</h2>${Q.finalQuestions.map((q, i) => `<p><strong>${i + 1}.</strong> ${esc(q)}</p><div class="write-lines tall"></div>`).join('')}</section>
      <section class="page-break">${checklistHtml(iv, Q)}</section>
      ${goldenHtml()}`, iv ? `#/interview/${iv.id}/overview` : '#/library');
  } else if (kind === 'evrequest') {
    const iv = await loadIv();
    const files = await api('GET', `/api/attachments?interview=${id}`);
    printFrame(`Evidence request ${iv.ref}`, evidenceLetterHtml(iv, evidenceRows(iv, files)), '#/evidence');
  } else if (kind === 'checklist') {
    const iv = id ? await loadIv() : null;
    printFrame('Interview checklist' + (iv ? ' ' + iv.ref : ''), checklistHtml(iv, iv ? qnOf(iv) : blankQn), iv ? `#/interview/${iv.id}/checklist` : '#/interviews');
  } else if (kind === 'record') {
    const iv = await loadIv();
    const fs = await api('GET', `/api/findings?interview=${id}`);
    const d = iv.data, Q = qnOf(iv);
    const secHtml = Q.sections.map((s) => {
      const sd = d.sections?.[s.id] || {};
      const qa = [s.opener, ...s.questions].filter((q) => hasAnswer(sd.answers?.[q.id]))
        .concat(orphanAnswers(s, sd).map(([id]) => ({ id, q: `(Question ${id} - no longer in the questionnaire)` })));
      const evs = s.evidence.map((e) => [e.text, sd.evidence?.[e.id]]).filter(([, x]) => hasEvidence(x))
        .concat(orphanEvidence(s, sd).map(([id, x]) => [`(Evidence item ${id} - no longer in the questionnaire)`, x]));
      if (sd.evidence?.other?.name) evs.push([sd.evidence.other.name, sd.evidence.other]);
      const four = T.fourWay.filter(([k]) => sd.four?.[k]);
      if (!qa.length && !evs.length && !four.length && !sd.gaps && (!sd.rating || sd.rating === 'Not assessed')) return `<section class="print-sec compact"><h3>${s.no}. ${esc(s.title)}</h3><p class="muted">Not covered.</p></section>`;
      return `<section class="print-sec"><h3>${s.no}. ${esc(s.title)} <span class="rating-tag">${esc(sd.rating || 'Not assessed')}</span></h3>
        ${qa.map((q) => { const a = sd.answers[q.id]; return `<div class="qa"><p class="q">${q.id === 'opener' ? '★ ' : ''}${esc(q.q)}${a.qa ? ` <span class="qa-print qa-${q.type ? T.answerSignal(q, a.qa) : 'fact'}">${esc(a.qa)}</span>` : ''}${a.flag ? ' <strong class="flag-tag">⚑ red flag</strong>' : ''}${a.later ? ' <strong class="flag-tag">↻ come back to</strong>' : ''}</p><p class="a">${nl2br(a.r || '-')}</p>${a.ev && a.ev !== 'Not requested' ? `<p class="ev">Evidence: ${esc(a.ev)}</p>` : ''}</div>`; }).join('')}
        ${evs.length ? `<h4>Evidence</h4><table class="table print-table"><tbody>${evs.map(([e, x]) => `<tr><td>${esc(e)}</td><td>${esc(x.status || '')}</td><td>${esc(x.ref || '')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${four.length ? `<h4>Four-way comparison</h4><table class="kv-table">${four.map(([k, l]) => `<tr><th>${esc(l)}</th><td>${nl2br(sd.four[k])}</td></tr>`).join('')}</table>` : ''}
        ${sd.gaps ? `<h4>Gaps identified</h4><p>${nl2br(sd.gaps)}</p>` : ''}</section>`;
    }).join('');
    const rfs = Q.redFlags.filter((f) => d.redFlags?.[f.id]?.on);
    printFrame(`Interview record ${iv.ref}`, `
      <header class="doc-head"><h1>${esc(Q.guideTitle)} - Record</h1>${headerTable(iv)}${d.header?.notes ? `<p><strong>Preparation notes:</strong> ${nl2br(d.header.notes)}</p>` : ''}</header>
      ${secHtml}
      <section class="print-sec"><h2>Red flags heard</h2>${rfs.length ? `<ul>${rfs.map((f) => `<li>“${esc(f.quote)}”${d.redFlags[f.id].note ? ' - ' + nl2br(d.redFlags[f.id].note) : ''}</li>`).join('')}</ul>` : '<p>None recorded.</p>'}${d.redFlags?.other?.note ? `<p>${nl2br(d.redFlags.other.note)}</p>` : ''}</section>
      <section class="print-sec"><h2>Final questions</h2>${Q.finalQuestions.map((q, i) => `<div class="qa"><p class="q">${esc(q)}</p><p class="a">${nl2br(d.final?.['q' + i] || '-')}</p></div>`).join('')}${d.final?.closing ? `<h4>Closing notes</h4><p>${nl2br(d.final.closing)}</p>` : ''}</section>
      <section class="print-sec"><h2>Findings</h2>${printFindingsTable(fs)}</section>
      <section class="page-break">${checklistHtml(iv)}</section>`, `#/interview/${iv.id}/overview`);
  } else if (kind === 'report') {
    const iv = await loadIv();
    const fs = await api('GET', `/api/findings?interview=${id}`);
    const r = iv.data.report || {}, Q = qnOf(iv);
    printFrame(`Interview report ${iv.ref}`, `
      <header class="doc-head"><h1>${esc(Q.guideTitle)} - Report</h1>${headerTable(iv)}</header>
      ${(() => { const m = execSummaryModel(iv, fs); return `<section class="print-sec"><h2>Executive summary</h2><div class="es-overall es-${m.tone}"><span class="es-label">Overall assessment${m.overall === m.auto ? ' (indicative)' : ''}</span><strong>${esc(m.overall)}</strong><p>${esc(m.headline)}</p></div></section>`; })()}
      ${Q.reportSections.map(([k, l], i) => `<section class="print-sec"><h2>${i + 1}. ${esc(l)}</h2><p>${nl2br(r[k] || 'Not completed.')}</p></section>`).join('')}
      <section class="print-sec"><h2>Findings register extract</h2>${printFindingsTable(fs)}</section>
      <section class="print-sec"><h2>Final questions</h2>${Q.finalQuestions.map((q, i) => `<div class="qa"><p class="q">${esc(q)}</p><p class="a">${nl2br(iv.data.final?.['q' + i] || '-')}</p></div>`).join('')}</section>
      <section class="print-sec"><p class="hint">${esc(T.APPLIES)} Findings are classified to distinguish regulatory requirements from expectations, good practice, internal policy, control weaknesses and technical debt.</p></section>
      <section class="print-sec signoff"><h2>Sign-off</h2><div class="pf-grid">${['Prepared by', 'Date', 'Reviewed by', 'Date'].map((l) => `<div class="pf"><span>${l}</span><span class="pf-line"></span></div>`).join('')}</div></section>`, `#/interview/${iv.id}/report`, () => wordInterviewReport(iv.id));
  } else if (kind === 'execsum') {
    const iv = await loadIv();
    const fs = await api('GET', `/api/findings?interview=${id}`);
    printFrame(`Executive summary ${iv.ref}`, execSummaryHtml(execSummaryModel(iv, fs)), `#/interview/${iv.id}/report`, () => wordExecSummary(iv.id));
  } else if (kind === 'briefing') {
    const { ivs, fs, doc } = await loadBriefingInputs();
    printFrame(briefingTitle(doc), briefingHtml(briefingModel(ivs, fs, lastReportFilters, doc)), '#/reports/briefing', wordBriefing);
  } else if (kind === 'themes' || kind === 'trends') {
    const [ivs, fs] = await Promise.all([api('GET', '/api/interviews?full=1'), api('GET', '/api/findings')]);
    const flt = lastReportFilters;
    const fl = filterLabel(flt);
    const themes = kind === 'themes';
    printFrame(themes ? 'Programme themes' : 'Programme trends', `<header class="doc-head"><h1>Technology Risk Interview Programme - ${themes ? 'Themes' : 'Trends'}</h1><p>Filters: ${esc(fl || 'none (all data)')}</p></header>
      <div class="print-stats">${themes ? themesHtml(themesModel(ivs, fs, flt)) : trendsHtml(trendsModel(ivs, fs, flt))}</div>`, `#/reports/${kind}`, themes ? () => wordThemes(flt) : null);
    $$('.print-stats details').forEach((d) => { d.open = true; });
  } else if (kind === 'findings') {
    const [fs, ivs] = await Promise.all([api('GET', '/api/findings'), api('GET', '/api/interviews')]);
    const ref = Object.fromEntries(ivs.map((i) => [i.id, i.ref]));
    printFrame('Findings register', `<header class="doc-head"><h1>Technology Risk Findings Register</h1><p>${fs.length} findings · ${fs.filter((f) => f.status !== 'Closed').length} open</p></header>
      ${printFindingsTable(fs)}
      ${fs.map((f) => `<section class="print-sec page-break-before">${findingDetailHtml(f, ref[f.interviewId] || '')}</section>`).join('')}`, '#/findings', wordFindingsRegister);
  } else if (kind === 'finding') {
    const [fs, ivs] = await Promise.all([api('GET', '/api/findings'), api('GET', '/api/interviews')]);
    const f = fs.find((x) => x.id === id); if (!f) throw new Error('Finding not found.');
    const iv = ivs.find((i) => i.id === f.interviewId);
    printFrame(`Finding ${f.ref}`, `<header class="doc-head"><h1>Technology Risk Finding</h1></header>${findingDetailHtml(f, iv ? iv.ref : '')}`, `#/finding/${f.id}`);
  } else if (kind === 'stats') {
    const [ivs, fs] = await Promise.all([api('GET', '/api/interviews?full=1'), api('GET', '/api/findings')]);
    const flt = lastReportFilters;
    const st = computeStats(ivs, fs, flt);
    const fl = filterLabel(flt);
    printFrame('Technology risk statistics', `<header class="doc-head"><h1>Technology Risk Interview Programme - Statistics</h1><p>Filters: ${esc(fl || 'none (all data)')}</p></header>
      <div class="print-stats">${statsHtml(st)}</div>`, '#/reports/stats');
    $$('.print-stats details').forEach((d) => { d.open = true; });
  } else if (AUD_KINDS[kind]) {
    await viewPrintAudience(kind);
  } else if (kind === 'services' || kind === 'service') {
    await viewPrintServices(kind === 'service' ? id : null);
  } else location.hash = '#/dashboard';
}
