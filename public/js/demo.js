// Demonstration data: three example interviews with findings and evidence, all flagged demo:true so they are
// labelled DEMO everywhere and can be removed in one click. Dates are relative to today so the worklist,
// overdue evidence and expiring risk acceptance always show something.
'use strict';

function buildDemoData() {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); // n days ago (negative = in future)
  const ts = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const me = state.user;
  const A = (qa, r, extra) => ({ ...(qa ? { qa } : {}), ...(r ? { r } : {}), ...extra });
  const hdr = (h) => ({ interviewer: me.fullName, depth: 'standard', deploymentModel: 'Hybrid', containers: 'Yes', dataClassification: 'Highly confidential / restricted', ...h });
  const interviews = [
    { id: 9001, ref: 'DEMO-INT-0001', status: 'Complete', createdBy: me.username, createdAt: ts(20), data: { demo: true, questionnaireId: 'dev', questionnaireVersion: T.QUESTIONNAIRE_VERSION,
      header: hdr({ developerName: 'Sam Example (demo)', developerRole: 'Tech lead', team: 'Demo Payments Engineering', applications: 'Demo Payments Gateway, Demo Card API', businessService: 'Retail payments (important business service)', criticality: 'Tier 1 - critical / important business service', date: day(20), location: 'Meeting room 2' }),
      sections: {
        s1: { rating: 'Effective', answers: { opener: A(null, 'Tech lead for the payments gateway; owns releases and third-line support.'), 's1-q1': A('Clear', 'Tech lead, 6 developers'), 's1-q5': A('Yes', 'Read-only via PAM; break-glass for fixes, approved by ops'), 's1-q9': A('Yes', 'Retail payments') } },
        s2: { rating: 'Partially effective', answers: { 's2-q10': A('Yes'), 's2-q13': A('Yes', '4 hours'), 's2-q14': A("Don't know", 'Thinks backups are nightly') } },
        s5: { rating: 'Partially effective', answers: { 's5-q1': A('Yes', 'Branch protection needs one approval'), 's5-q3': A('Yes', 'I can approve my own MR when the team is short', { flag: true }), 's5-q9': A('Partly', 'Admins can override; not reviewed') },
          four: { says: 'Every change is peer reviewed.', documented: 'SDLC standard requires independent approval.', enforced: 'Platform allows the author to approve if they hold maintainer rights.', evidenced: 'Two self-approved merges found in the last month.' },
          gaps: 'Policy requires independent review, but the platform does not enforce it and self-approved merges exist.' },
        s7: { rating: 'Ineffective', answers: { 's7-q1': A('Vague', 'Mostly Key Vault; some older services use appsettings'), 's7-q5': A('No'), 's7-q6': A('Yes', 'DB password in appsettings.json on two servers', { flag: true }), 's7-q8': A("Don't know"), 's7-q12': A('Vague', 'We would delete the commit') },
          evidence: { 's7-e1': { status: 'Requested', due: day(3), owner: 'Sam Example (demo)' }, 's7-e4': { status: 'Seen - verified', ref: 'Vault rotation log exported ' + day(18) } } },
        s9: { rating: 'Effective', answers: { 's9-q2': A('Clear', 'Unit, SAST, SCA and secret scan on every build'), 's9-q9': A('No'), 's9-q10': A('No'), 's9-q13': A('Yes') } },
        s22: { rating: 'Ineffective', answers: { 's22-q8': A('No', 'Never restored in anger', { flag: true }), 's22-q9': A("Don't know") }, evidence: { 's22-e3': { status: 'Requested', due: day(-10) } } },
      },
      redFlags: { rf6: { on: true, note: '"We keep a couple of passwords in the config file on the old servers."' }, rf9: { on: true, note: 'No restore test anyone can remember.' } },
      final: { q0: 'The batch scheduler - nobody really owns it.', q1: 'Get the last secrets into Key Vault and test a restore.', evidenceDue: day(3) },
      checklist: { role: true, apps: true, criticality: true, codeReview: true, secrets: true, cicd: true, backup: true, risks: true } } },
    { id: 9002, ref: 'DEMO-INT-0002', status: 'Complete', createdBy: me.username, createdAt: ts(45), data: { demo: true, questionnaireId: 'dev', questionnaireVersion: T.QUESTIONNAIRE_VERSION,
      header: hdr({ developerName: 'Alex Example (demo)', developerRole: 'Developer', team: 'Demo Payments Engineering', applications: 'Demo Payments Gateway', businessService: 'Retail payments (important business service)', criticality: 'Tier 1 - critical / important business service', date: day(45), interviewer: 'Another Assessor (demo)' }),
      sections: {
        s1: { rating: 'Effective', answers: { 's1-q5': A('No', 'No production access at all') } },
        s5: { rating: 'Effective', answers: { 's5-q1': A('Yes'), 's5-q3': A('No', 'GitLab blocks it'), 's5-q9': A('No') } },
        s7: { rating: 'Partially effective', answers: { 's7-q6': A('No', 'Everything is in Key Vault'), 's7-q8': A('Clear', 'Rotated every 90 days by the platform') } },
        s22: { rating: 'Partially effective', answers: { 's22-q8': A("Don't know") } },
      },
      redFlags: { rf9: { on: true } } } },
    { id: 9003, ref: 'DEMO-INT-0003', status: 'In progress', createdBy: me.username, createdAt: ts(75), data: { demo: true, questionnaireId: 'dev', questionnaireVersion: T.QUESTIONNAIRE_VERSION,
      header: hdr({ developerName: 'Jo Example (demo)', developerRole: 'Senior developer', team: 'Demo Customer Onboarding', applications: 'Demo Onboarding API', businessService: 'Account opening', criticality: 'Tier 2 - high', date: day(75), depth: 'core', deploymentModel: 'On-premises', containers: 'No' }),
      sections: {
        s12: { rating: 'Ineffective', answers: { 's12-q1': A('Vague', 'Most of the team, I think'), 's12-q4': A('No', 'Permanent', { later: true }), 's12-q8': A('Yes', 'We run fixes straight on the prod DB', { flag: true }) },
          evidence: { 's12-e1': { status: 'Requested', due: day(-12) } } },
        s13: { answers: { 's13-q10': A('Partly', 'Masked copy, but some fields are real') } },
      },
      redFlags: { rf3: { on: true, note: '"Most of us can get on to prod."' } } } },
  ];
  const tf = (tplId, crit, over) => ({ ...templateValues(templateById(tplId), crit), demo: true, createdBy: me.username, ...over });
  const T1 = 'Tier 1 - critical / important business service';
  const findings = [
    tf('tpl-secrets-in-config', T1, { ref: 'DEMO-TRF-0001', interviewId: 9001, status: 'Open', application: 'Demo Payments Gateway', developerTeam: 'Sam Example (demo) / Demo Payments Engineering', residualLikelihood: 4, residualImpact: 4, controlEffectiveness: 'Ineffective', existingControl: 'Key Vault used for newer services only.', classification: 'Confirmed risk', controlOwner: 'Head of Payments Engineering (demo)', targetDate: day(-20), createdAt: ts(20) }),
    tf('tpl-backup-untested', T1, { ref: 'DEMO-TRF-0002', interviewId: 9001, status: 'In remediation', application: 'Demo Payments Gateway', controlEffectiveness: 'Not tested', controlOwner: 'Platform Operations lead (demo)', targetDate: day(5), progressNotes: 'Restore test booked with ops; slipped once.', createdAt: ts(20) }),
    tf('tpl-self-approval', T1, { ref: 'DEMO-TRF-0003', interviewId: 9001, status: 'Risk accepted', application: 'Demo Payments Gateway', likelihood: 3, impact: 4, controlEffectiveness: 'Partially effective',
      riskAcceptance: 'Yes', riskAcceptanceRef: 'CIO (demo) - RA-DEMO-01', riskAcceptanceExpiry: day(-14), remediation: 'Platform upgrade due next quarter will enforce independent approval; monthly review of self-approved merges meanwhile.', createdAt: ts(20) }),
    tf('tpl-standing-prod-access', 'Tier 2 - high', { ref: 'DEMO-TRF-0004', interviewId: 9003, status: 'Open', application: 'Demo Onboarding API', controlOwner: 'Onboarding engineering manager (demo)', targetDate: day(-40), createdAt: ts(70) }),
    tf('tpl-secrets-in-config', T1, { ref: 'DEMO-TRF-0005', interviewId: 9002, status: 'Closed', application: 'Demo Card API', createdAt: ts(45), closedAt: ts(30),
      closureEvidence: 'Remaining secrets moved to Key Vault; secret scan of the repository clean on ' + day(31) + '; appsettings reviewed on both servers.', closureVerifiedBy: 'Another Assessor (demo)' }),
  ];
  // Two demo services; the payments interviews support retail payments, the onboarding one account opening.
  const services = [
    { id: 9101, ref: 'DEMO-IBS-001', demo: true, name: 'Retail payments - making a payment (demo)', designation: 'Important business service', status: 'Approved', regulators: 'PRA and FCA',
      description: 'Customers make Faster Payments and card payments from their accounts.', customers: 'Retail customers', owner: 'Head of Payments (demo)', accountableSmf: 'SMF24 Chief Operations (demo)',
      toleranceText: 'Customers can make payments within 4 hours of disruption, with no more than one day of delayed payments.', toleranceHours: 4, otherMetrics: 'No more than 50,000 customers unable to pay',
      people: 'Demo Payments Engineering\nPayments Operations\nOn-call rota', processes: 'Payment initiation\nSanctions screening\nEnd-of-day reconciliation',
      technology: 'Demo Payments Gateway\nDemo Card API\nCore banking ledger', suppliers: 'Cloud provider\nFaster Payments access provider\nCard processor', facilities: 'Head office\nRemote working', data: 'Customer account data\nPayment instructions',
      scenarioTestDate: day(400), scenarioResult: 'Breached tolerance', scenarioNotes: 'Loss of cloud region: payments recovered in 5h 20m against a 4h tolerance.', vulnerabilities: 'Untested backup restore for the gateway database (DEMO-TRF-0002).',
      reviewDate: day(120), approvedBy: 'Board Risk Committee (demo)', createdBy: me.username },
    { id: 9102, ref: 'DEMO-IBS-002', demo: true, name: 'Account opening (demo)', designation: 'Important business service', status: 'Draft', regulators: 'PRA and FCA',
      description: 'New customers open a current or savings account in the app.', customers: 'Prospective retail customers', owner: 'Head of Onboarding (demo)',
      toleranceText: 'New customers can open an account within 2 days.', toleranceHours: 48, technology: 'Demo Onboarding API\nIdentity verification service', suppliers: 'Identity verification provider',
      people: 'Demo Customer Onboarding', createdBy: me.username },
  ];
  interviews.forEach((i) => { i.data.header.serviceIds = i.id === 9003 ? [9102] : [9101]; });
  return { services, interviews, findings };
}
