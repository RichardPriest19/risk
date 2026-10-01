// First-time help: "?" explanations next to confusing fields, a short guided tour, and the welcome card.
'use strict';

const HELP = {
  classification: ['Classification', () => `<p>Say what kind of finding this is. Do not treat every weakness as a regulatory breach.</p>
    <table class="table">${T.classifications.map((c) => `<tr><th>${esc(c.id)}</th><td>${esc(c.desc)}</td></tr>`).join('')}</table>
    <p class="hint">Rule of thumb: <strong>requirement</strong> = binding and applies to this entity; <strong>expectation</strong> = regulator guidance on how to comply; <strong>good practice</strong> = recognised but not mandatory.</p>`],
  inherentResidual: ['Inherent and residual risk', () => `<p><strong>Inherent risk</strong> is the risk before taking account of the controls that exist today. <strong>Residual risk</strong> is what remains after those existing controls.</p>
    <p>Score = likelihood (1-5) × impact (1-5): <strong>1-4 Low · 5-9 Medium · 10-16 High · 20-25 Critical</strong>.</p>
    <p>If the existing control is weak or untested, residual will be close to inherent. Leave residual blank until you have evidence about the control.</p>
    <table class="table"><tr><th>Likelihood</th><td>${T.likelihood.map(([n, l]) => `${n} ${esc(l)}`).join(' · ')}</td></tr><tr><th>Impact</th><td>${T.impact.map(([n, l]) => `${n} ${esc(l)}`).join(' · ')}</td></tr></table>`],
  controlEffectiveness: ['Control effectiveness', () => `<dl class="guide-dl"><dt>Effective</dt><dd>Designed well and evidenced as operating.</dd><dt>Partially effective</dt><dd>Operates, but with gaps - some cases missed, bypassable, or evidence incomplete.</dd><dt>Ineffective</dt><dd>Exists on paper but does not prevent or detect the risk.</dd><dt>Not tested</dt><dd>Described, but you have not seen evidence either way.</dd><dt>No control</dt><dd>Nothing addresses the risk.</dd></dl>`],
  ukAreas: ['Regulatory areas', () => `<p>The regulatory areas a finding relates to. The PRA is the bank's prudential regulator, so PRA areas come first; FCA (conduct, including the Consumer Duty) and ICO (data protection) areas follow.</p>
    <table class="table">${T.ukAreas.map((a) => `<tr><th>${esc(a.area)}</th><td>${esc(a.regulator)}</td><td>${esc(a.source)}</td></tr>`).join('')}</table>
    <p><strong>Consumer Duty</strong> matters most where technology failure harms customers: outages, wrong balances, failed or duplicated payments, poor incident communication.</p>
    <p class="hint">Templates tick the usual areas for you. Name the specific rule under “Specific rules”.</p>`],
  findingStatus: ['Finding status', () => `<dl class="guide-dl"><dt>Open</dt><dd>Agreed, not yet being fixed.</dd><dt>In remediation</dt><dd>Work under way; keep the target date and progress notes current.</dd>
    <dt>Risk accepted</dt><dd>The business has formally decided to live with the risk. <strong>Needs an approver/reference and an expiry date.</strong></dd>
    <dt>Closed</dt><dd>Fixed and verified. <strong>Needs closure evidence and the name of whoever verified it.</strong></dd></dl><p class="hint">Every change is recorded in the finding's history.</p>`],
  services: ['Important business services', () => `<p>An <strong>important business service</strong> is a service the bank provides to customers or markets whose disruption could cause intolerable harm to customers or risk the bank's safety and soundness (PRA SS1/21). For each one the bank sets an <strong>impact tolerance</strong> - the maximum tolerable disruption - maps the people, processes, technology, facilities, information and suppliers behind it, and tests that it can stay within tolerance in severe but plausible scenarios.</p>
    <p>Use the names and tolerances from the bank's operational resilience self-assessment. Link interviews (on their Overview) and findings to a service, and its page shows which departments have been interviewed, the open findings, weak control areas and evidence outstanding for it. Candidates still under review can be recorded too.</p>`],
  riskAcceptance: ['Risk acceptance', () => `<p>A formal, time-limited decision by someone with the authority to accept this level of risk (per the bank's risk framework) - not the interviewee or team lead alone for High/Critical risks.</p>
    <p>Record <strong>who approved it and the reference</strong> (e.g. risk committee minute), and <strong>when it expires</strong>. The dashboard warns 30 days before expiry; at expiry it must be re-approved or remediated.</p>`],
  closure: ['Closure evidence', () => `<p>Closing a finding needs evidence that the fix <em>operates</em>, not just that a change was made. Good closure evidence is specific and dated:</p>
    <ul><li>“Branch protection now blocks self-approval - setting screenshot 30/09; MR !482 shows independent approval.”</li><li>“Restore of prod backup to DR completed 14/10 in 2h10m (RTO 4h) - test record attached.”</li></ul>
    <p>Attach the files: each is fingerprinted (SHA-256) so it can later be shown to be unaltered. <strong>Verified by</strong> is the person who checked the evidence - ideally not the person who made the fix.</p>`],
  sectionRating: ['Control assessment', () => `<p>Your overall view of the controls in this area, based on the four-way comparison - not on what the interviewee says alone.</p>
    <dl class="guide-dl"><dt>Effective</dt><dd>Said, documented, enforced <em>and</em> evidenced.</dd><dt>Partially effective</dt><dd>Mostly works, with gaps between the four views.</dd><dt>Ineffective</dt><dd>Significant gap - e.g. relies on goodwill, or no evidence it happens.</dd><dt>Not applicable</dt><dd>The area does not apply to this system.</dd></dl>`],
  fourWay: ['Four-way comparison', () => `<p>For each area compare four views. The gaps between them are where the risk lives.</p>
    <ol>${T.fourWay.map(([, l]) => `<li>${esc(l)}</li>`).join('')}</ol>
    <p>Example: a developer says “every change is reviewed”; the policy agrees; but the platform lets the author approve (not enforced) and there are merges with no approver (evidence) - a gap to raise.</p>`],
  quickAnswers: ['Quick answers', () => `<p>One-click answers that feed the statistics, comparisons and report draft.</p>
    <p><strong>Yes/no questions:</strong> Yes · Partly · No · Don't know · N/A. <strong>Open questions:</strong> Clear · Vague · Don't know · N/A.</p>
    <p>Colours follow the meaning of the question: “Yes” to <em>Is MFA enforced?</em> is green, but “Yes” to <em>Can developers approve their own changes?</em> is red. Plain facts (e.g. <em>Does it process payments?</em>) are blue - neither good nor bad.</p>`],
  evidenceStatus: ['Evidence status', () => `<dl class="guide-dl"><dt>Not requested</dt><dd>Not asked for (yet).</dd><dt>Requested</dt><dd>Asked for; appears in the evidence tracker and request letter.</dd>
    <dt>Seen - not verified</dt><dd>Received, but not yet checked that it shows the control operating.</dd><dt>Seen - verified</dt><dd>Checked, and it demonstrates the control.</dd><dt>Not available</dt><dd>The evidence does not exist - itself a useful finding.</dd></dl>`],
  depth: ['Interview depth', () => `<dl class="guide-dl">${T.depths.map((d) => `<dt>${esc(d.label)} (~${d.minutes} min)</dt><dd>${esc(d.desc)}</dd>`).join('')}</dl>
    <p>Until you choose, the depth follows the application's criticality. Anything already answered always stays visible.</p>`],
  overall: ['Overall assessment', () => `<p>Worked out from the interview unless you choose one:</p>
    <ul><li><strong>Significant weaknesses</strong> - any open Critical finding, or two or more High.</li><li><strong>Weaknesses requiring action</strong> - a High finding or an Ineffective area.</li>
    <li><strong>Generally adequate, improvements needed</strong> - Partially effective areas or Medium findings.</li><li><strong>Controls operating effectively</strong> - rated areas are Effective, no significant findings.</li></ul>
    <p>It is marked “indicative” until you set it yourself.</p>`],
  template: ['Finding templates', () => `<p>Standard wording for findings that recur, so different assessors describe the same issue the same way and the Themes report can count them.</p>
    <p>Applying a template fills empty fields only. Likelihood and impact are suggestions (impact adjusted for criticality) - always adjust to your evidence. <a href="#/library/templates">Browse all templates</a>.</p>`],
  compareKinds: ['Contradictions and gaps', () => `<dl class="guide-dl"><dt>Contradiction</dt><dd>One interviewee said Yes and another No about the team or system. At least one account is wrong.</dd>
    <dt>Partial disagreement</dt><dd>Definite answers differ in another way, e.g. Yes vs Partly.</dd><dt>Knowledge gap</dt><dd>One knew and another said “Don't know” (or one clear, one vague).</dd></dl>
    <p>Questions about the individual (their role, own access, training) are not flagged. Resolve a contradiction with the evidence, not by majority.</p>`],
};
function helpBtn(key) {
  const h = HELP[key]; if (!h) return '';
  return `<button type="button" class="help-btn" data-help="${key}" aria-label="Help: ${esc(h[0])}" title="What does this mean?">?</button>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-help]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const [title, body] = HELP[b.dataset.help];
  const d = document.createElement('dialog'); d.className = 'dialog dialog-wide help-dialog';
  d.innerHTML = `<h3>${esc(title)}</h3><div>${body()}</div><div class="row-end"><button class="btn" type="button">Close</button></div>`;
  document.body.appendChild(d);
  $('.row-end .btn', d).onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }); // click outside closes
  d.showModal();
});

// ---------- welcome card and demo data (dashboard) ----------
function welcomeHtml(ivs) {
  const demo = ivs.some((i) => i.demo);
  const real = ivs.filter((i) => !i.demo).length;
  const demoBanner = demo ? `<div class="notice demo-notice"><p><span class="demo-tag">DEMO</span> <strong>Demonstration data is loaded</strong> - interviews and findings marked DEMO are examples, not real records. They are included in reports while loaded.
    ${canEdit() ? '<button type="button" class="btn btn-small" data-help-action="remove-demo">Remove demo data</button>' : ''}</p></div>` : '';
  if (real > 0 || getPref('welcome', '') === 'dismissed') return demoBanner;
  return demoBanner + `<section class="card welcome"><div class="row-between"><h2>Getting started</h2><button type="button" class="btn btn-small btn-ghost" data-help-action="dismiss-welcome" aria-label="Dismiss">✕</button></div>
    <p>This workbench guides one-to-one Technology Risk interviews - ${T.questionnaires.map((q) => esc(q.subjects)).join(', ')} - from planning, through the conversation, to findings, evidence and reports.</p>
    <div class="welcome-steps">
      <button type="button" class="welcome-step" data-help-action="tour"><strong>1. Take the 2-minute tour</strong><span>See where everything is.</span></button>
      ${canEdit() ? `<button type="button" class="welcome-step" data-help-action="load-demo"${demo ? ' disabled' : ''}><strong>2. Explore with demo data</strong><span>${demo ? 'Loaded - look for the DEMO labels.' : 'Three example interviews, findings and evidence. Remove them in one click.'}</span></button>` : ''}
      <a class="welcome-step" href="#/library/guide"><strong>${canEdit() ? '3' : '2'}. Read how to use the guide</strong><span>The interview method in five minutes.</span></a>
      ${canEdit() ? `<button type="button" class="welcome-step" data-help-action="new"><strong>${canEdit() ? '4' : ''}. Start a real interview</strong><span>Look for the <b>?</b> buttons if a field is unclear.</span></button>` : ''}
    </div></section>`;
}
function bindWelcome() { /* actions are handled by the delegated listener below */ }
document.addEventListener('click', async (e) => {
  const a = e.target.closest && e.target.closest('[data-help-action]');
  if (!a || !state.user) return;
  const act = a.dataset.helpAction;
  const menu = a.closest('details.menu'); if (menu) menu.open = false;
  if (act === 'tour') { location.hash = '#/dashboard'; setTimeout(() => startTour(), 400); }
  if (act === 'dismiss-welcome') { setPref('welcome', 'dismissed'); a.closest('.welcome').remove(); }
  if (act === 'new') newInterview();
  if (act === 'load-demo') {
    if (!(await modalConfirm('Load three example interviews with findings and evidence? They are clearly labelled DEMO and can be removed in one click (Help menu or dashboard).', 'Load demo data'))) return;
    try { const r = await api('POST', '/api/import', { ...buildDemoData(), source: 'demo data' }); toast(`Demo data loaded: ${r.interviews} interviews, ${r.findings} findings.`); location.hash = '#/dashboard'; route(); }
    catch (err) { fail(err); }
  }
  if (act === 'remove-demo') {
    if (!(await modalConfirm('Remove all demo interviews and findings? Real records are not affected.', 'Remove demo data'))) return;
    try { const r = await api('POST', '/api/demo/remove', {}); toast(`Removed ${r.interviews} demo interview(s) and ${r.findings} demo finding(s).`); state.iv = null; location.hash = '#/dashboard'; route(); }
    catch (err) { fail(err); }
  }
});

// ---------- guided tour ----------
function tourSteps() {
  return [
    { title: 'Welcome', text: 'A two-minute tour of the workbench. Use the arrow keys or the buttons; press Esc to stop at any time.' },
    { sel: '.mainnav a[href="#/interviews"]', title: 'Interviews', text: 'Plan and run interviews. Each has an Overview (depth and sections), the 29 question sections, red flags, final questions, a checklist and a report - plus ▶ Meeting mode for the conversation itself.' },
    { sel: '#newIv', title: 'Start an interview', text: 'Creates a new interview. Set the application criticality first - the app recommends how deep to go and leaves out sections that do not apply.' },
    { sel: '#worklist .work-head', title: 'Your worklist', text: 'Drafts to finish, overdue evidence, findings due this month and risk acceptances about to expire. Switch between “Mine” and “Everyone”.' },
    { sel: '.mainnav a[href="#/evidence"]', title: 'Evidence tracker', text: 'Every piece of evidence requested, with due dates, chasing, request letters and fingerprinted file attachments.' },
    { sel: '.mainnav a[href="#/compare"]', title: 'Compare interviewees', text: 'Puts answers from people on the same team side by side and highlights contradictions - often where the real risk is.' },
    { sel: '.mainnav a[href="#/findings"]', title: 'Findings', text: 'The findings register. Start findings from standard templates or directly from a red flag; closing one needs closure evidence, and every change is kept in its history.' },
    { sel: '.mainnav a[href="#/reports"]', title: 'Reports', text: 'Reports for each audience: a plain-English report for the Board, one for the Head of Compliance, and a technical report and briefing paper for the CTO - each prints or downloads as Word. Statistics, themes and trends are kept separately as working analysis.' },
    { sel: '.mainnav a[href="#/library"]', title: 'Guide and library', text: 'The interview method, the full question bank, red flags, finding templates, and the PRA requirements mapping.' },
    { sel: '.help-menu summary', title: 'Help any time', text: 'Restart this tour or load demo data from here. Throughout the app, a small “?” next to a field explains what it means.' },
    { title: 'Try it out', text: canEdit() ? 'The quickest way to learn is to explore the demo data - three example interviews with findings, evidence and a contradiction to spot. You can remove it in one click.' : 'Open an interview or the Guide and library to explore.', demo: canEdit() },
  ];
}
function maybeStartTour() {
  if (getPref('tour', '') !== 'done') setTimeout(() => { if (location.hash === '#/dashboard' && !document.querySelector('.tour')) startTour(); }, 600);
}
function startTour() {
  document.querySelector('.tour')?.remove();
  const steps = tourSteps().filter((s) => !s.sel || document.querySelector(s.sel));
  let i = 0;
  const ov = document.createElement('div'); ov.className = 'tour';
  ov.innerHTML = '<div class="tour-spot"></div><div class="tour-box" role="dialog" aria-modal="true" aria-labelledby="tourTitle"></div>';
  document.body.appendChild(ov);
  const spot = $('.tour-spot', ov), box = $('.tour-box', ov);
  const end = () => { setPref('tour', 'done'); ov.remove(); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', show); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); end(); } if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } };
  const go = (d) => { i += d; if (i >= steps.length) return end(); i = Math.max(0, i); show(); };
  function show() {
    const s = steps[i], el = s.sel && document.querySelector(s.sel);
    box.innerHTML = `<p class="tour-count">${i + 1} of ${steps.length}</p><h3 id="tourTitle">${esc(s.title)}</h3><p>${esc(s.text)}</p>
      <div class="row-between"><button type="button" class="btn btn-small btn-ghost" data-t="skip">Skip tour</button>
      <span class="row">${i ? '<button type="button" class="btn btn-small" data-t="back">Back</button>' : ''}${s.demo ? '<button type="button" class="btn btn-small" data-help-action="load-demo" data-t="end">Load demo data</button>' : ''}<button type="button" class="btn btn-small btn-primary" data-t="next">${i === steps.length - 1 ? 'Finish' : 'Next'}</button></span></div>`;
    $('[data-t=next]', box).onclick = () => go(1);
    const b = $('[data-t=back]', box); if (b) b.onclick = () => go(-1);
    $('[data-t=skip]', box).onclick = end;
    const d = $('[data-t=end]', box); if (d) d.addEventListener('click', end);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      Object.assign(spot.style, { display: 'block', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
      ov.classList.remove('tour-dim');
      const bw = Math.min(380, window.innerWidth - 24);
      const left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left));
      const below = r.bottom + 14 + 220 < window.innerHeight;
      Object.assign(box.style, { width: `${bw}px`, left: `${left}px`, top: below ? `${r.bottom + 14}px` : '', bottom: below ? '' : `${window.innerHeight - r.top + 14}px`, transform: '' });
    } else {
      spot.style.display = 'none'; ov.classList.add('tour-dim');
      Object.assign(box.style, { width: `${Math.min(420, window.innerWidth - 24)}px`, left: '50%', top: '30%', bottom: '', transform: 'translateX(-50%)' });
    }
    $('[data-t=next]', box).focus();
  }
  document.addEventListener('keydown', key, true);
  window.addEventListener('resize', show);
  show();
}
