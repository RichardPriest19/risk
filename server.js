// Technology Risk Interview App - local server.
// Zero third-party dependencies: Node.js (v22.13+) built-in http, crypto and sqlite.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 && process.argv[argPort + 1]) || Number(process.env.PORT) || 8420;
const HOST = process.env.HOST || '127.0.0.1'; // local-only by default
const argData = process.argv.indexOf('--data');
const DATA_DIR = (argData > 0 && process.argv[argData + 1]) || process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const IDLE_MINUTES = 30;
const ABSOLUTE_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 12;
const ROLES = ['admin', 'assessor', 'viewer'];

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'app.db');
let db; // reassigned by openDb() after a restore
const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Draft',
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  interview_id INTEGER REFERENCES interviews(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT
);
-- Evidence files. Kept inside the database (not loose files) so every backup and restore includes them.
-- A file belongs to an interview evidence item, or to a finding (e.g. closure evidence).
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER REFERENCES interviews(id) ON DELETE CASCADE,
  finding_id INTEGER REFERENCES findings(id) ON DELETE CASCADE,
  item_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  note TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  CHECK (interview_id IS NOT NULL OR finding_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS attachments_interview ON attachments(interview_id);
CREATE TABLE IF NOT EXISTS attachment_blobs (
  attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  content BLOB NOT NULL
);
-- Every change to a finding: who, when, and each field's old and new value.
CREATE TABLE IF NOT EXISTS finding_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  username TEXT,
  action TEXT NOT NULL,
  changes TEXT
);
CREATE INDEX IF NOT EXISTS finding_history_finding ON finding_history(finding_id);
-- Register of (important) business services (PRA SS1/21). Interviews (data.header.serviceIds) and findings (data.serviceIds) link to them.
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT, created_at TEXT NOT NULL,
  updated_by TEXT, updated_at TEXT NOT NULL
);
-- Shared programme-level documents (e.g. the wording of the CTO briefing), one row per document.
CREATE TABLE IF NOT EXISTS app_docs (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
`;
function openDb() {
  db = new DatabaseSync(DB_FILE);
  db.exec(SCHEMA);
  upgradeAttachmentsTable();
}
// Databases created before finding attachments had interview_id NOT NULL and no finding_id. SQLite cannot change a
// column constraint in place, so the table is rebuilt in one transaction (all rows and ids kept; file contents untouched).
function upgradeAttachmentsTable() {
  const cols = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
  if (!cols.includes('finding_id')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`CREATE TABLE attachments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          interview_id INTEGER REFERENCES interviews(id) ON DELETE CASCADE,
          finding_id INTEGER REFERENCES findings(id) ON DELETE CASCADE,
          item_path TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
          note TEXT, uploaded_by TEXT, uploaded_at TEXT NOT NULL,
          CHECK (interview_id IS NOT NULL OR finding_id IS NOT NULL));
        INSERT INTO attachments_new (id, interview_id, item_path, filename, size, sha256, note, uploaded_by, uploaded_at)
          SELECT id, interview_id, item_path, filename, size, sha256, note, uploaded_by, uploaded_at FROM attachments;
        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;
        CREATE INDEX IF NOT EXISTS attachments_interview ON attachments(interview_id);`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  db.exec('CREATE INDEX IF NOT EXISTS attachments_finding ON attachments(finding_id)');
}
openDb();

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash, salt };
}
function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'Password must contain at least three of: lower case, upper case, number, symbol.';
  return null;
}

function audit(req, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit (ts, username, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?)').run(
    now(), req.user ? req.user.username : (req.attemptedUser || null), action, entity || null,
    entityId == null ? null : String(entityId), detail ? String(detail).slice(0, 2000) : null,
    req.socket.remoteAddress || null
  );
}

// ---------- questionnaire content: permanent-ID checks ----------
const CONTENT_FILE = path.join(PUBLIC_DIR, 'js', 'content.js');
const LOCK_FILE = path.join(__dirname, 'question-ids.lock.json');
let CONTENT_VERSION = 'unknown';
let QN_IDS = ['dev']; let DEFAULT_QN = 'dev'; let QN_TITLES = {}; let QN_SECTIONS = {};
function checkContentIds() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(CONTENT_FILE, 'utf8'), ctx, { filename: 'content.js' });
  const T = ctx.window.TR;
  CONTENT_VERSION = T.QUESTIONNAIRE_VERSION || 'unknown';
  const items = new Map(); const errors = []; const seen = new Set();
  const once = (id, where) => { if (seen.has(id)) errors.push(`"${id}" is used more than once (${where})`); seen.add(id); };
  for (const qn of T.questionnaires || []) {
    if (!/^[a-z]{2,12}$/.test(String(qn.id))) { errors.push(`questionnaire id "${qn.id}" must be 2-12 lower-case letters`); continue; }
    once('questionnaire:' + qn.id, 'questionnaire ids');
    // Only the original 'dev' questionnaire has unprefixed IDs; every other one must prefix all IDs with its own id.
    const pre = qn.legacyIds ? '' : `${qn.id}-`;
    for (const s of qn.sections) {
      if (!new RegExp(`^${pre}s\\d+$`).test(String(s.id))) errors.push(`section "${s.id}" in questionnaire ${qn.id} should look like ${pre}s<number>`);
      once(s.id, 'section ids');
      const list = [...s.questions.map((q) => [q.id, q.q, 'q']), ...s.evidence.map((e) => [e.id, e.text, 'e'])];
      for (const [id, text, kind] of list) {
        if (!new RegExp(`^${s.id}-${kind}\\d+$`).test(String(id))) errors.push(`"${id}" in ${qn.id} section ${s.no} should look like ${s.id}-${kind}<number>`);
        if (items.has(id)) errors.push(`"${id}" is used more than once`);
        items.set(id, text);
      }
    }
    for (const r of qn.redFlags) {
      if (!new RegExp(`^${pre}rf\\d+$`).test(String(r.id))) errors.push(`red flag "${r.id}" in questionnaire ${qn.id} should look like ${pre}rf<number>`);
      once(r.id, 'red flag ids');
    }
  }
  if (!(T.questionnaires || []).length) errors.push('no questionnaires defined');
  QN_IDS = (T.questionnaires || []).map((q) => q.id); DEFAULT_QN = T.DEFAULT_QN || QN_IDS[0];
  QN_TITLES = Object.fromEntries((T.questionnaires || []).map((q) => [q.id, q.title]));
  QN_SECTIONS = Object.fromEntries((T.questionnaires || []).map((q) => [q.id, new Set(q.sections.map((x) => x.id))]));
  if (errors.length) {
    console.error('\n  STOPPED: problems with question IDs in public/js/content.js:\n   - ' + errors.join('\n   - ') + '\n  Fix these before starting the app, so that answers are never attached to the wrong question.\n');
    process.exit(1);
  }
  let lock = {};
  try { lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch { /* first run */ }
  const removed = Object.keys(lock).filter((id) => !items.has(id));
  const changed = Object.keys(lock).filter((id) => items.has(id) && items.get(id) !== lock[id]);
  const added = [...items.keys()].filter((id) => !(id in lock));
  if (removed.length) console.warn(`\n  WARNING: ${removed.length} question/evidence ID(s) were deleted from content.js: ${removed.join(', ')}\n  Answers already saved against them are kept and shown as "no longer in the questionnaire".\n  Put them back with  retired: true  rather than deleting them.\n`);
  if (changed.length) console.warn(`  Note: wording changed for ${changed.join(', ')}. If the meaning changed, retire the old item and add a new ID instead.\n`);
  if (added.length || changed.length) {
    for (const id of added) lock[id] = items.get(id);
    for (const id of changed) lock[id] = items.get(id);
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 1));
  }
}

// Interviews saved before permanent IDs existed stored answers by position (q0, q1...) and evidence by index (0, 1...).
// Those positions correspond exactly to questionnaire 2026.1 IDs: q<i> -> s<N>-q<i+1>, <i> -> s<N>-e<i+1>.
// Interviews saved before the app held several questionnaires all used the software development one.
function migrateInterviewData(data) {
  if (!data || typeof data !== 'object') return false;
  let changed = false;
  if (!data.questionnaireId) { data.questionnaireId = DEFAULT_QN; changed = true; }
  if (data.questionnaireVersion) return changed;
  for (const [sid, sec] of Object.entries(data.sections || {})) {
    if (!sec || typeof sec !== 'object') continue;
    // Never overwrite: if a new-format entry already exists for the same item (possible when an updated browser page
    // saved into a not-yet-restarted server), the legacy entry is kept as "legacy-<key>" and shown as an unmatched answer.
    const remap = (obj, rename) => {
      const out = Object.fromEntries(Object.entries(obj).filter(([k]) => rename(k) === null));
      for (const [k, v] of Object.entries(obj)) {
        const nk = rename(k); if (nk === null) continue;
        out[out[nk] === undefined ? nk : `legacy-${k}`] = v;
      }
      return out;
    };
    if (sec.answers) sec.answers = remap(sec.answers, (k) => { const m = /^q(\d+)$/.exec(k); return m ? `${sid}-q${Number(m[1]) + 1}` : null; });
    if (sec.evidence) sec.evidence = remap(sec.evidence, (k) => (/^\d+$/.test(k) ? `${sid}-e${Number(k) + 1}` : null));
  }
  data.questionnaireVersion = '2026.1';
  return true;
}
function migrateLegacyInterviews() {
  const rows = db.prepare('SELECT id, ref, data FROM interviews').all().filter((r) => { const d = JSON.parse(r.data); return !d.questionnaireVersion || !d.questionnaireId; });
  const positional = rows.filter((r) => !JSON.parse(r.data).questionnaireVersion).length;
  if (!rows.length) return;
  try { runBackup('pre-migration', 'system'); } catch (e) { console.error('  Could not take a backup before upgrading saved answers: ' + e.message + '\n  Upgrade postponed; the app will try again at next start.'); return; }
  db.exec('BEGIN');
  for (const r of rows) {
    const d = JSON.parse(r.data); migrateInterviewData(d);
    db.prepare('UPDATE interviews SET data = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(d), r.id);
  }
  db.exec('COMMIT');
  db.prepare('INSERT INTO audit (ts, username, action, entity, detail) VALUES (?,?,?,?,?)').run(now(), 'system', 'MIGRATION', 'interview', `${rows.length} interview(s) upgraded${positional ? ` (${positional} to permanent question IDs)` : ''}; questionnaire recorded as "${DEFAULT_QN}" where missing`);
  console.log(`  Upgraded ${rows.length} saved interview(s) to the current format (a backup was taken first).`);
}

// ---------- automatic backups ----------
const BACKUP_SETTINGS_FILE = path.join(DATA_DIR, 'backup-settings.json'); // outside the database so a restore never changes it
const BACKUP_LOG_FILE = path.join(DATA_DIR, 'backup-log.jsonl');
const BACKUP_RE = /^tech-risk-(backup|pre-restore|pre-migration)-(\d{4}-\d\d-\d\d-\d{6}(?:-\d+)?)\.db$/;
const BACKUP_DEFAULTS = { enabled: true, dir: path.join(DATA_DIR, 'backups'), intervalHours: 24, retention: 30 };
function getBackupSettings() {
  try { return { ...BACKUP_DEFAULTS, ...JSON.parse(fs.readFileSync(BACKUP_SETTINGS_FILE, 'utf8')) }; } catch { return { ...BACKUP_DEFAULTS }; }
}
function isOneDrivePath(p) {
  const full = path.resolve(p).toLowerCase();
  const roots = [process.env.OneDrive, process.env.OneDriveCommercial, process.env.OneDriveConsumer].filter(Boolean).map((r) => path.resolve(r).toLowerCase());
  return /[\\/]onedrive( - [^\\/]*)?([\\/]|$)/.test(full) || roots.some((r) => full === r || full.startsWith(r + path.sep));
}
function prepareBackupDir(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new HttpError(400, 'Enter a full folder path, e.g. D:\\TechRiskBackups or \\\\server\\share\\TechRisk.');
  if (isOneDrivePath(dir)) throw new HttpError(400, 'Backups must not be stored in OneDrive. Choose a local, external or network folder.');
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.write-test-${process.pid}`);
  fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
}
function fileSha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function verifyDbFile(file) {
  let check;
  try { check = new DatabaseSync(file, { readOnly: true }); } catch { throw new HttpError(400, 'The file is not a readable database.'); }
  try {
    let ok;
    try { ok = check.prepare('PRAGMA integrity_check').get(); } catch { throw new HttpError(400, 'The file is not a readable database.'); }
    if (!ok || Object.values(ok)[0] !== 'ok') throw new HttpError(400, 'The database failed its integrity check.');
    const tables = new Set(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
    for (const t of ['users', 'interviews', 'findings', 'audit']) if (!tables.has(t)) throw new HttpError(400, 'The file is not a Technology Risk Interview App database.');
    const count = (t) => check.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    return { interviews: count('interviews'), findings: count('findings'), users: count('users') };
  } finally { check.close(); }
}
function backupLog(entry) {
  try { fs.appendFileSync(BACKUP_LOG_FILE, JSON.stringify({ ts: now(), ...entry }) + '\n'); } catch (e) { console.error('Could not write backup log: ' + e.message); }
}
function readBackupLog(limit = 50) {
  try { return fs.readFileSync(BACKUP_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-limit).reverse(); } catch { return []; }
}
function pruneBackups(dir, retention) {
  const keep = { backup: retention, 'pre-restore': 10, 'pre-migration': 5 };
  const byKind = {};
  for (const f of fs.readdirSync(dir)) { const m = BACKUP_RE.exec(f); if (m) (byKind[m[1]] = byKind[m[1]] || []).push(f); }
  const removed = [];
  for (const [kind, files] of Object.entries(byKind)) {
    files.sort().reverse().slice(keep[kind]).forEach((f) => {
      fs.rmSync(path.join(dir, f), { force: true }); fs.rmSync(path.join(dir, f + '.sha256'), { force: true }); removed.push(f);
    });
  }
  return removed;
}
function runBackup(trigger, username) {
  const s = getBackupSettings();
  const kind = trigger === 'pre-restore' || trigger === 'pre-migration' ? trigger : 'backup';
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0'); // local time, so file names match the clock on screen
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  let name = `tech-risk-${kind}-${stamp}.db`;
  let file = path.join(s.dir, name), tmp;
  try {
    prepareBackupDir(s.dir);
    for (let n = 2; fs.existsSync(file); n++) { name = `tech-risk-${kind}-${stamp}-${n}.db`; file = path.join(s.dir, name); } // same-second backups
    tmp = file + '.partial';
    fs.rmSync(tmp, { force: true });
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const counts = verifyDbFile(tmp);
    fs.renameSync(tmp, file);
    const hash = fileSha256(file);
    fs.writeFileSync(file + '.sha256', `${hash}  ${name}\n`);
    const removed = pruneBackups(s.dir, s.retention);
    const result = { ok: true, trigger, by: username, file: name, dir: s.dir, size: fs.statSync(file).size, sha256: hash, ...counts, pruned: removed.length };
    backupLog(result);
    return result;
  } catch (e) {
    if (tmp) fs.rmSync(tmp, { force: true });
    backupLog({ ok: false, trigger, by: username, dir: s.dir, error: e.message });
    throw e instanceof HttpError ? e : new HttpError(500, 'Backup failed: ' + e.message);
  }
}
function backupStatus() {
  const s = getBackupSettings();
  const log = readBackupLog(200);
  const lastOk = log.find((l) => l.ok && (l.trigger === 'scheduled' || l.trigger === 'manual'));
  const lastAttempt = log.find((l) => l.trigger === 'scheduled' || l.trigger === 'manual');
  const ageH = lastOk ? (Date.now() - Date.parse(lastOk.ts)) / 3600e3 : Infinity;
  let warning = null;
  if (!s.enabled) warning = 'Automatic backups are turned off.';
  else if (lastAttempt && !lastAttempt.ok) warning = `The last backup failed: ${lastAttempt.error}`;
  else if (ageH > s.intervalHours * 2) warning = lastOk ? `The last successful backup was ${Math.floor(ageH / 24)} day(s) ago.` : 'No backup has been taken yet.';
  const sameDrive = !s.dir.startsWith('\\\\') && path.resolve(s.dir).slice(0, 2).toLowerCase() === path.resolve(DB_FILE).slice(0, 2).toLowerCase();
  return {
    settings: s, lastOk: lastOk || null, lastAttempt: lastAttempt || null, warning, sameDrive, dbFile: DB_FILE,
    nextDue: s.enabled ? (lastOk ? new Date(Date.parse(lastOk.ts) + s.intervalHours * 3600e3).toISOString() : now()) : null,
  };
}
let lastScheduledFailure = 0;
function scheduledBackupCheck() {
  const s = getBackupSettings();
  if (!s.enabled || Date.now() - lastScheduledFailure < 3600e3) return;
  const lastOk = readBackupLog(200).find((l) => l.ok && (l.trigger === 'scheduled' || l.trigger === 'manual'));
  if (lastOk && Date.now() - Date.parse(lastOk.ts) < s.intervalHours * 3600e3) return;
  try { const r = runBackup('scheduled', 'system'); console.log(`  Automatic backup saved: ${path.join(r.dir, r.file)}`); }
  catch (e) { lastScheduledFailure = Date.now(); console.error('  Automatic backup FAILED: ' + e.message); }
}
function listBackups() {
  const s = getBackupSettings();
  if (!fs.existsSync(s.dir)) return [];
  return fs.readdirSync(s.dir).filter((f) => BACKUP_RE.test(f)).sort().reverse().map((f) => {
    const full = path.join(s.dir, f); const st = fs.statSync(full);
    let hashOk = null;
    try { hashOk = fs.readFileSync(full + '.sha256', 'utf8').split(/\s+/)[0] === fileSha256(full); } catch { /* no hash file */ }
    return { file: f, kind: BACKUP_RE.exec(f)[1], size: st.size, modified: st.mtime.toISOString(), hashOk };
  });
}
function restoreFromFile(sourceFile, req, label) {
  const counts = verifyDbFile(sourceFile);
  const safety = runBackup('pre-restore', req.user.username);
  const who = req.user.username;
  db.close();
  try {
    const tmp = DB_FILE + '.restoring';
    fs.copyFileSync(sourceFile, tmp);
    fs.renameSync(tmp, DB_FILE);
  } finally { openDb(); }
  migrateLegacyInterviews();
  db.prepare('DELETE FROM sessions').run(); // everyone signs in again against the restored user list
  db.prepare('INSERT INTO audit (ts, username, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?)').run(
    now(), who, 'RESTORE', 'database', label, `Restored ${counts.interviews} interviews, ${counts.findings} findings. Previous data saved as ${safety.file}`, req.socket.remoteAddress || null);
  backupLog({ ok: true, trigger: 'restore', by: who, file: label, safety: safety.file, ...counts });
  return { ...counts, safetyBackup: safety.file };
}

// ---------- reference numbers ----------
function nextRef(table, prefix) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = db.prepare(`SELECT ref FROM ${table} WHERE ref LIKE ? ORDER BY ref DESC LIMIT 1`).get(like);
  const n = row ? parseInt(row.ref.split('-')[2], 10) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

// ---------- business services register ----------
function nextServiceRef() {
  const n = db.prepare("SELECT ref FROM services WHERE ref LIKE 'IBS-%'").all().map((r) => parseInt(r.ref.slice(4), 10)).filter((x) => x > 0);
  return 'IBS-' + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0');
}
const rowService = (r) => ({ id: r.id, ref: r.ref, version: r.version, createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at, ...JSON.parse(r.data) });
const SERVICE_META = new Set(['id', 'ref', 'version', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt']);
function serviceData(body) {
  const d = {};
  for (const [k, v] of Object.entries(body || {})) if (!SERVICE_META.has(k)) d[k] = v;
  d.name = String(d.name || '').trim().slice(0, 200);
  if (!d.name) throw new HttpError(400, 'A service needs a name.');
  if (d.toleranceHours !== undefined && d.toleranceHours !== '' && !(Number(d.toleranceHours) > 0)) throw new HttpError(400, 'Impact tolerance (hours) must be a positive number.');
  return d;
}
// Keep only links to services that exist (no duplicates).
function cleanServiceIds(ids) {
  if (!Array.isArray(ids)) return [];
  const known = new Set(db.prepare('SELECT id FROM services').all().map((r) => r.id));
  return [...new Set(ids.map(Number).filter((x) => known.has(x)))];
}

// ---------- sessions ----------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function loadSession(req) {
  const token = parseCookies(req).trsid;
  if (!token) return null;
  const th = sha256(token);
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(th);
  if (!s) return null;
  const t = Date.now();
  if (t - s.last_seen > IDLE_MINUTES * 60e3 || t - s.created_at > ABSOLUTE_HOURS * 3600e3) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(th);
    return null;
  }
  const u = db.prepare('SELECT id, username, full_name, role, active, must_change FROM users WHERE id = ?').get(s.user_id);
  if (!u || !u.active) return null;
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(t, th);
  req.sessionHash = th;
  return { id: u.id, username: u.username, fullName: u.full_name, role: u.role, mustChange: !!u.must_change };
}
function cookieHeader(token, maxAge) {
  return `trsid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

// ---------- http helpers ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'File too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function requireRole(req, ...roles) {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  if (req.user.mustChange) throw new HttpError(403, 'You must change your password first');
  if (roles.length && !roles.includes(req.user.role)) throw new HttpError(403, 'You do not have permission to do that');
}
const canEdit = (req) => requireRole(req, 'admin', 'assessor');

function rowInterview(r, full = true) {
  const data = JSON.parse(r.data);
  const base = {
    id: r.id, ref: r.ref, status: r.status, version: r.version,
    createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
  };
  return full ? { ...base, data } : { ...base, questionnaireId: data.questionnaireId || DEFAULT_QN, header: data.header || {}, evidence: evidenceSummary(data), progress: progressSummary(data), demo: !!data.demo };
}
// For the dashboard worklist: sections rated so far and questions marked "come back to this".
function progressSummary(data) {
  const secs = Object.values(data.sections || {});
  return {
    rated: secs.filter((s) => s?.rating && s.rating !== 'Not assessed').length,
    later: secs.reduce((a, s) => a + Object.values(s?.answers || {}).filter((x) => x?.later).length, 0),
  };
}
// Outstanding = requested but not yet received; overdue = outstanding and past its due date.
function evidenceSummary(data) {
  const today = now().slice(0, 10); let outstanding = 0, overdue = 0;
  for (const sec of Object.values(data.sections || {})) {
    const items = [...Object.values(sec?.evidence || {}).map((x) => [x?.status, x?.due]), ...Object.values(sec?.answers || {}).map((a) => [a?.ev, a?.evDue])];
    for (const [status, due] of items) if (status === 'Requested') { outstanding++; if (due && due < today) overdue++; }
  }
  return { outstanding, overdue };
}
// Evidence tracker edits touch one item only, merged into the latest saved interview (no whole-document overwrite).
const EVIDENCE_PATH = /^sections\.((?:[a-z]{2,12}-)?s\d+)\.(evidence|answers)\.([\w-]+)$/;
// A section must belong to the interview's own questionnaire.
const sectionInQn = (data, sid) => !!QN_SECTIONS[data.questionnaireId || DEFAULT_QN]?.has(sid);
const EVIDENCE_FIELDS = {
  evidence: { status: 'status', ref: 'ref', name: 'name', due: 'due', owner: 'owner', notes: 'notes', chases: 'chases' },
  answers: { status: 'ev', ref: 'evRef', due: 'evDue', owner: 'evOwner', notes: 'evNotes', chases: 'evChases' },
};
const EVIDENCE_STATUSES = ['Not requested', 'Requested', 'Seen - verified', 'Seen - not verified', 'Not available'];
function rowFinding(r) {
  return {
    id: r.id, ref: r.ref, interviewId: r.interview_id, version: r.version, ...JSON.parse(r.data),
    createdBy: r.created_by, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
  };
}
const FINDING_META = new Set(['id', 'ref', 'interviewId', 'version', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt']);
function findingData(body) {
  const d = {};
  for (const [k, v] of Object.entries(body || {})) if (!FINDING_META.has(k)) d[k] = v;
  return d;
}
// A finding may only be closed with closure evidence and a named verifier, and a risk may only be accepted with an
// approver/reference and a future expiry date. Checked on the change of status (existing records are not affected).
function checkFindingStatusRules(beforeStatus, next) {
  if (next.status === 'Closed' && beforeStatus !== 'Closed') {
    if (String(next.closureEvidence || '').trim().length < 20) throw new HttpError(400, 'To close a finding, describe the closure evidence (at least 20 characters): what was changed, and what you saw that proves it.');
    if (!String(next.closureVerifiedBy || '').trim()) throw new HttpError(400, 'To close a finding, record who verified the closure evidence.');
  }
  if (next.status === 'Risk accepted' && beforeStatus !== 'Risk accepted') {
    if (!String(next.riskAcceptanceRef || '').trim()) throw new HttpError(400, 'To accept a risk, record who approved it (and the reference to the approval).');
    if (!/^\d{4}-\d\d-\d\d$/.test(String(next.riskAcceptanceExpiry || ''))) throw new HttpError(400, 'To accept a risk, set the date the acceptance expires.');
    if (next.riskAcceptanceExpiry <= now().slice(0, 10)) throw new HttpError(400, 'The risk acceptance expiry date must be in the future.');
  }
}
const HISTORY_SKIP = new Set(['closedAt', 'sourceSection', 'sourceQuestion', 'doraAreas', 'doraRelevance']); // DORA fields are no longer used
const BLANK_MEANS_NO = new Set(['riskAcceptance', 'escalation']); // blank and "No" are the same answer - not a change
function findingDiff(before, next) {
  // Lists (e.g. regulatory areas) are compared as sets, so the same items in a different order are not a change.
  const show = (v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? '' : Array.isArray(v) ? [...v].map(String).sort().join(', ') : String(v)).slice(0, 2000);
  const norm = (k, v) => (BLANK_MEANS_NO.has(k) && v === 'No' ? '' : v);
  return [...new Set([...Object.keys(before), ...Object.keys(next)])].filter((k) => !HISTORY_SKIP.has(k))
    .map((k) => ({ f: k, from: show(before[k]), to: show(next[k]) })).filter((d) => norm(d.f, d.from) !== norm(d.f, d.to));
}
function addFindingHistory(findingId, username, action, changes) {
  db.prepare('INSERT INTO finding_history (finding_id, ts, username, action, changes) VALUES (?,?,?,?,?)').run(findingId, now(), username, action, JSON.stringify(changes || []));
}
function validInterviewId(id) {
  if (id == null || id === '') return null;
  const r = db.prepare('SELECT id FROM interviews WHERE id = ?').get(Number(id));
  return r ? r.id : null;
}

// ---------- CSV ----------
function csvCell(v) {
  if (v == null) return '';
  let s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return '﻿' + [headers.map((h) => csvCell(h.label)).join(',')]
    .concat(rows.map((r) => headers.map((h) => csvCell(h.get(r))).join(','))).join('\r\n');
}
const FINDING_CSV = [
  ['Finding ID', 'ref'], ['Interview', 'interviewRef'], ['Application/system', 'application'], ['Interviewee/team', 'developerTeam'], ['Business services', 'serviceRefs'],
  ['Risk category', 'category'], ['Title', 'title'], ['Description', 'description'], ['Evidence', 'evidence'],
  ['Existing control', 'existingControl'], ['Control effectiveness', 'controlEffectiveness'],
  ['Likelihood', 'likelihood'], ['Impact', 'impact'], ['Inherent score', 'inherentScore'], ['Inherent rating', 'inherentRating'],
  ['Residual likelihood', 'residualLikelihood'], ['Residual impact', 'residualImpact'], ['Residual score', 'residualScore'], ['Residual rating', 'residualRating'],
  ['Classification', 'classification'], ['Regulatory areas', 'ukAreas'], ['Regulatory relevance', 'regulatoryRelevance'],
  ['UK regulatory relevance', 'ukRelevance'], ['Security relevance', 'securityRelevance'], ['Operational resilience relevance', 'opresRelevance'],
  ['Recommended remediation', 'remediation'], ['Control owner', 'controlOwner'], ['Target date', 'targetDate'],
  ['Risk acceptance required', 'riskAcceptance'], ['Escalation required', 'escalation'], ['Escalated to', 'escalatedTo'], ['Status', 'status'],
  ['Risk acceptance reference', 'riskAcceptanceRef'], ['Risk acceptance expiry', 'riskAcceptanceExpiry'],
  ['Closure evidence', 'closureEvidence'], ['Closure verified by', 'closureVerifiedBy'],
  ['Template', 'templateId'], ['Closed at', 'closedAt'],
  ['Created by', 'createdBy'], ['Created at', 'createdAt'], ['Updated at', 'updatedAt'],
];
function scoreRating(s) { return !s ? '' : s >= 20 ? 'Critical' : s >= 10 ? 'High' : s >= 5 ? 'Medium' : 'Low'; }

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/status', (req) => {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  return { setupRequired: count === 0, user: req.user || null, idleMinutes: IDLE_MINUTES, minPassword: MIN_PASSWORD };
});

route('POST', '/api/setup', async (req) => {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) throw new HttpError(409, 'Setup has already been completed');
  const b = await readBody(req);
  const username = String(b.username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Username must be 3-40 letters, numbers, dots, dashes or underscores.');
  const p = passwordProblem(b.password); if (p) throw new HttpError(400, p);
  const { hash, salt } = hashPassword(b.password);
  db.prepare('INSERT INTO users (username, full_name, role, pass_hash, salt, created_at) VALUES (?,?,?,?,?,?)')
    .run(username, String(b.fullName || username).slice(0, 100), 'admin', hash, salt, now());
  req.attemptedUser = username;
  audit(req, 'SETUP', 'user', username, 'Initial administrator created');
  return { ok: true };
});

route('POST', '/api/login', async (req, res) => {
  const b = await readBody(req);
  const username = String(b.username || '').trim();
  req.attemptedUser = username;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const generic = new HttpError(401, 'Invalid username or password, or the account is locked.');
  if (!u) { hashPassword(String(b.password || '')); audit(req, 'LOGIN_FAILED', 'user', username, 'Unknown user'); throw generic; }
  if (!u.active) { audit(req, 'LOGIN_FAILED', 'user', username, 'Account disabled'); throw generic; }
  if (u.locked_until && u.locked_until > Date.now()) { audit(req, 'LOGIN_FAILED', 'user', username, 'Account locked'); throw generic; }
  if (!verifyPassword(String(b.password || ''), u.salt, u.pass_hash)) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILED ? Date.now() + LOCK_MINUTES * 60e3 : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, u.id);
    audit(req, 'LOGIN_FAILED', 'user', username, lock ? `Bad password - locked for ${LOCK_MINUTES} minutes` : `Bad password (${fails})`);
    throw generic;
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = ? WHERE id = ?').run(now(), u.id);
  const token = crypto.randomBytes(32).toString('base64url');
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?,?,?,?)').run(sha256(token), u.id, t, t);
  req.user = { username: u.username };
  audit(req, 'LOGIN', 'user', u.username);
  res.setHeader('Set-Cookie', cookieHeader(token, ABSOLUTE_HOURS * 3600));
  return { ok: true };
});

route('POST', '/api/logout', (req, res) => {
  if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
  if (req.user) audit(req, 'LOGOUT', 'user', req.user.username);
  res.setHeader('Set-Cookie', cookieHeader('', 0));
  return { ok: true };
});

route('POST', '/api/change-password', async (req) => {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  const b = await readBody(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(b.current || ''), u.salt, u.pass_hash)) throw new HttpError(400, 'Current password is incorrect.');
  const p = passwordProblem(b.password); if (p) throw new HttpError(400, p);
  if (b.password === b.current) throw new HttpError(400, 'New password must differ from the current one.');
  const { hash, salt } = hashPassword(b.password);
  db.prepare('UPDATE users SET pass_hash = ?, salt = ?, must_change = 0 WHERE id = ?').run(hash, salt, u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, req.sessionHash);
  audit(req, 'PASSWORD_CHANGED', 'user', u.username);
  return { ok: true };
});

// ----- users (admin) -----
route('GET', '/api/users', (req) => {
  requireRole(req, 'admin');
  return db.prepare('SELECT id, username, full_name fullName, role, active, must_change mustChange, locked_until lockedUntil, created_at createdAt, last_login lastLogin FROM users ORDER BY username').all();
});
route('POST', '/api/users', async (req) => {
  requireRole(req, 'admin');
  const b = await readBody(req);
  const username = String(b.username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new HttpError(400, 'Username must be 3-40 letters, numbers, dots, dashes or underscores.');
  if (!ROLES.includes(b.role)) throw new HttpError(400, 'Invalid role');
  const p = passwordProblem(b.password); if (p) throw new HttpError(400, p);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username already exists.');
  // A deleted user's username is never reused, so records and the audit log stay attributable to one person.
  if (db.prepare("SELECT 1 FROM audit WHERE action = 'USER_DELETED' AND entity_id = ? COLLATE NOCASE").get(username)) throw new HttpError(409, 'That username belonged to a deleted user. Choose a different one so that existing records stay attributable to the right person.');
  const { hash, salt } = hashPassword(b.password);
  const r = db.prepare('INSERT INTO users (username, full_name, role, pass_hash, salt, must_change, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(username, String(b.fullName || username).slice(0, 100), b.role, hash, salt, now());
  audit(req, 'USER_CREATED', 'user', username, `Role ${b.role}`);
  return { id: Number(r.lastInsertRowid) };
});
// The app must always keep at least one active admin who can manage it.
const otherActiveAdmins = (id) => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id).n;
route('PUT', '/api/users/:id', async (req, res, params) => {
  requireRole(req, 'admin');
  const b = await readBody(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!u) throw new HttpError(404, 'User not found');
  const changes = [];
  if (b.role !== undefined && b.role !== u.role) {
    if (!ROLES.includes(b.role)) throw new HttpError(400, 'Invalid role');
    if (u.id === req.user.id) throw new HttpError(400, 'You cannot change your own role.');
    if (u.role === 'admin' && u.active && !otherActiveAdmins(u.id)) throw new HttpError(400, 'This is the only active admin. Make another user an admin first.');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, u.id); changes.push(`role ${u.role} -> ${b.role}`);
  }
  if (b.fullName !== undefined && String(b.fullName).trim() !== u.full_name) {
    const name = String(b.fullName).trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Full name cannot be empty.');
    db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(name, u.id); changes.push(`name "${u.full_name}" -> "${name}"`);
  }
  if (b.active !== undefined && !!b.active !== !!u.active) {
    if (u.id === req.user.id) throw new HttpError(400, 'You cannot disable your own account.');
    if (!b.active && u.role === 'admin' && !otherActiveAdmins(u.id)) throw new HttpError(400, 'This is the only active admin. Make another user an admin first.');
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id);
    if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    changes.push(b.active ? 'enabled' : 'disabled');
  }
  if (b.unlock) { db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id); changes.push('unlocked'); }
  if (b.password) {
    const p = passwordProblem(b.password); if (p) throw new HttpError(400, p);
    const { hash, salt } = hashPassword(b.password);
    db.prepare('UPDATE users SET pass_hash = ?, salt = ?, must_change = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, salt, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    changes.push('password reset');
  }
  if (changes.length) audit(req, 'USER_UPDATED', 'user', u.username, changes.join(', '));
  return { ok: true, changes };
});
// Deleting a user removes the account and its sessions. Records keep the username that created or changed them,
// and the audit log is untouched, so history stays intact.
route('DELETE', '/api/users/:id', (req, res, params) => {
  requireRole(req, 'admin');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!u) throw new HttpError(404, 'User not found');
  if (u.id === req.user.id) throw new HttpError(400, 'You cannot delete your own account.');
  if (u.role === 'admin' && u.active && !otherActiveAdmins(u.id)) throw new HttpError(400, 'This is the only active admin. Make another user an admin first.');
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  audit(req, 'USER_DELETED', 'user', u.username, `${u.full_name} (${u.role}${u.active ? '' : ', disabled'})`);
  return { ok: true };
});

// ----- interviews -----
route('GET', '/api/interviews', (req, res, params, query) => {
  requireRole(req);
  const full = query.get('full') === '1';
  return db.prepare('SELECT * FROM interviews ORDER BY updated_at DESC').all().map((r) => rowInterview(r, full));
});
route('POST', '/api/interviews', async (req) => {
  canEdit(req);
  const b = await readBody(req);
  const ref = nextRef('interviews', 'INT');
  const data = b.data && typeof b.data === 'object' ? b.data : { header: {} };
  if (!data.questionnaireVersion) data.questionnaireVersion = CONTENT_VERSION;
  if (!data.questionnaireId) data.questionnaireId = DEFAULT_QN;
  if (!QN_IDS.includes(data.questionnaireId)) throw new HttpError(400, 'Unknown questionnaire.');
  if (data.header && data.header.serviceIds) data.header.serviceIds = cleanServiceIds(data.header.serviceIds);
  const r = db.prepare('INSERT INTO interviews (ref, status, data, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(ref, 'Draft', JSON.stringify(data), req.user.username, now(), req.user.username, now());
  audit(req, 'INTERVIEW_CREATED', 'interview', ref);
  return rowInterview(db.prepare('SELECT * FROM interviews WHERE id = ?').get(Number(r.lastInsertRowid)));
});
route('GET', '/api/interviews/:id', (req, res, params) => {
  requireRole(req);
  const r = db.prepare('SELECT * FROM interviews WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Interview not found');
  return rowInterview(r);
});
route('PUT', '/api/interviews/:id', async (req, res, params) => {
  canEdit(req);
  const b = await readBody(req);
  const r = db.prepare('SELECT * FROM interviews WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Interview not found');
  if (b.version !== r.version) throw new HttpError(409, `This interview was changed by ${r.updated_by} at ${r.updated_at}. Reload to see the latest version.`);
  const status = ['Draft', 'In progress', 'Complete', 'Archived'].includes(b.status) ? b.status : r.status;
  // An interview never changes questionnaire: its answers are keyed by that questionnaire's IDs.
  if (b.data && typeof b.data === 'object') b.data.questionnaireId = JSON.parse(r.data).questionnaireId || DEFAULT_QN;
  if (b.data?.header?.serviceIds) b.data.header.serviceIds = cleanServiceIds(b.data.header.serviceIds);
  db.prepare('UPDATE interviews SET data = ?, status = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(b.data || {}), status, req.user.username, now(), r.id);
  if (status !== r.status) audit(req, 'INTERVIEW_STATUS', 'interview', r.ref, `${r.status} -> ${status}`);
  else if (b.auditNote) audit(req, 'INTERVIEW_UPDATED', 'interview', r.ref, b.auditNote);
  return rowInterview(db.prepare('SELECT * FROM interviews WHERE id = ?').get(r.id));
});
route('DELETE', '/api/interviews/:id', (req, res, params) => {
  requireRole(req, 'admin');
  const r = db.prepare('SELECT * FROM interviews WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Interview not found');
  db.prepare('DELETE FROM interviews WHERE id = ?').run(r.id);
  audit(req, 'INTERVIEW_DELETED', 'interview', r.ref, `Interviewee: ${(JSON.parse(r.data).header || {}).developerName || ''}`);
  return { ok: true };
});
route('GET', '/api/interviews/:id/export', (req, res, params) => {
  requireRole(req, 'admin', 'assessor');
  const r = db.prepare('SELECT * FROM interviews WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Interview not found');
  const findings = db.prepare('SELECT * FROM findings WHERE interview_id = ?').all(r.id).map(rowFinding);
  audit(req, 'EXPORT', 'interview', r.ref, 'Single interview JSON');
  return { format: 'tech-risk-interview-app', formatVersion: 1, exportedAt: now(), exportedBy: req.user.username, interviews: [rowInterview(r)], findings };
});

// ----- findings -----
route('GET', '/api/findings', (req, res, params, query) => {
  requireRole(req);
  const iid = query.get('interview');
  const rows = iid ? db.prepare('SELECT * FROM findings WHERE interview_id = ? ORDER BY ref').all(Number(iid))
    : db.prepare('SELECT * FROM findings ORDER BY ref').all();
  return rows.map(rowFinding);
});
route('POST', '/api/findings', async (req) => {
  canEdit(req);
  const b = await readBody(req);
  const ref = nextRef('findings', 'TRF');
  const data = findingData(b);
  if (data.serviceIds) data.serviceIds = cleanServiceIds(data.serviceIds);
  checkFindingStatusRules(null, data);
  if (data.status === 'Closed') data.closedAt = now(); else delete data.closedAt;
  const r = db.prepare('INSERT INTO findings (ref, interview_id, data, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(ref, validInterviewId(b.interviewId), JSON.stringify(data), req.user.username, now(), req.user.username, now());
  const id = Number(r.lastInsertRowid);
  addFindingHistory(id, req.user.username, 'Created', findingDiff({}, data));
  audit(req, 'FINDING_CREATED', 'finding', ref, b.title);
  return rowFinding(db.prepare('SELECT * FROM findings WHERE id = ?').get(id));
});
route('PUT', '/api/findings/:id', async (req, res, params) => {
  canEdit(req);
  const b = await readBody(req);
  const r = db.prepare('SELECT * FROM findings WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Finding not found');
  if (b.version !== r.version) throw new HttpError(409, `This finding was changed by ${r.updated_by} at ${r.updated_at}. Reload to see the latest version.`);
  const before = JSON.parse(r.data);
  const next = findingData(b);
  if (next.serviceIds) next.serviceIds = cleanServiceIds(next.serviceIds);
  checkFindingStatusRules(before.status, next);
  // Closure date is set by the server (used for backlog trends): stamped on closing, kept while closed, cleared on reopening.
  if (next.status === 'Closed') next.closedAt = before.status === 'Closed' && before.closedAt ? before.closedAt : now();
  else delete next.closedAt;
  const newIv = validInterviewId(b.interviewId);
  db.prepare('UPDATE findings SET data = ?, interview_id = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(next), newIv, req.user.username, now(), r.id);
  const diff = findingDiff(before, next);
  if ((r.interview_id || null) !== (newIv || null)) {
    const refOf = (id) => (id ? db.prepare('SELECT ref FROM interviews WHERE id = ?').get(id)?.ref || String(id) : '');
    diff.push({ f: 'interview', from: refOf(r.interview_id), to: refOf(newIv) });
  }
  if (diff.length) {
    const action = next.status === before.status ? 'Updated' : next.status === 'Closed' ? 'Closed' : before.status === 'Closed' ? 'Reopened' : next.status === 'Risk accepted' ? 'Risk accepted' : 'Status changed';
    addFindingHistory(r.id, req.user.username, action, diff);
  }
  audit(req, 'FINDING_UPDATED', 'finding', r.ref, diff.length ? 'Changed: ' + diff.map((d) => d.f).join(', ') : 'No field changes');
  return rowFinding(db.prepare('SELECT * FROM findings WHERE id = ?').get(r.id));
});
route('GET', '/api/findings/:id/history', (req, res, params) => {
  requireRole(req);
  const r = db.prepare('SELECT id, created_by, created_at FROM findings WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Finding not found');
  const rows = db.prepare('SELECT * FROM finding_history WHERE finding_id = ? ORDER BY id DESC').all(r.id)
    .map((h) => ({ ts: h.ts, username: h.username, action: h.action, changes: JSON.parse(h.changes || '[]') }));
  return { createdBy: r.created_by, createdAt: r.created_at, entries: rows };
});
route('DELETE', '/api/findings/:id', (req, res, params) => {
  requireRole(req, 'admin');
  const r = db.prepare('SELECT * FROM findings WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Finding not found');
  db.prepare('DELETE FROM findings WHERE id = ?').run(r.id);
  audit(req, 'FINDING_DELETED', 'finding', r.ref, JSON.parse(r.data).title);
  return { ok: true };
});

// ----- import / export -----
route('GET', '/api/export/backup', (req) => {
  requireRole(req, 'admin', 'assessor');
  const interviews = db.prepare('SELECT * FROM interviews ORDER BY id').all().map((r) => rowInterview(r));
  const findings = db.prepare('SELECT * FROM findings ORDER BY id').all().map(rowFinding);
  const services = db.prepare('SELECT * FROM services ORDER BY id').all().map(rowService);
  audit(req, 'EXPORT', 'backup', null, `${interviews.length} interviews, ${findings.length} findings, ${services.length} services`);
  return { format: 'tech-risk-interview-app', formatVersion: 1, exportedAt: now(), exportedBy: req.user.username, services, interviews, findings };
});
route('GET', '/api/export/findings.csv', (req) => {
  requireRole(req, 'admin', 'assessor');
  const refs = Object.fromEntries(db.prepare('SELECT id, ref FROM interviews').all().map((r) => [r.id, r.ref]));
  const svcRefs = Object.fromEntries(db.prepare('SELECT id, ref FROM services').all().map((r) => [r.id, r.ref]));
  const rows = db.prepare('SELECT * FROM findings ORDER BY ref').all().map(rowFinding).map((f) => ({
    ...f, interviewRef: refs[f.interviewId] || '', serviceRefs: (f.serviceIds || []).map((x) => svcRefs[x]).filter(Boolean).join('; '),
    inherentScore: f.likelihood && f.impact ? f.likelihood * f.impact : '', inherentRating: scoreRating(f.likelihood * f.impact),
    residualScore: f.residualLikelihood && f.residualImpact ? f.residualLikelihood * f.residualImpact : '', residualRating: scoreRating(f.residualLikelihood * f.residualImpact),
  }));
  audit(req, 'EXPORT', 'findings', null, `CSV, ${rows.length} rows`);
  return { __csv: toCsv(FINDING_CSV.map(([label, k]) => ({ label, get: (r) => r[k] })), rows), filename: 'findings.csv' };
});
route('GET', '/api/export/interviews.csv', (req) => {
  requireRole(req, 'admin', 'assessor');
  const counts = Object.fromEntries(db.prepare('SELECT interview_id i, COUNT(*) c FROM findings GROUP BY interview_id').all().map((r) => [r.i, r.c]));
  const rows = db.prepare('SELECT * FROM interviews ORDER BY ref').all().map((r) => rowInterview(r));
  const H = [
    ['Interview ID', (r) => r.ref], ['Questionnaire', (r) => QN_TITLES[r.data.questionnaireId] || r.data.questionnaireId], ['Status', (r) => r.status], ['Date', (r) => r.data.header?.date], ['Interviewee', (r) => r.data.header?.developerName],
    ['Interviewee role', (r) => r.data.header?.developerRole], ['Team', (r) => r.data.header?.team], ['Applications', (r) => r.data.header?.applications],
    ['Business service', (r) => r.data.header?.businessService], ['Criticality', (r) => r.data.header?.criticality], ['Data classification', (r) => r.data.header?.dataClassification],
    ['Interviewer', (r) => r.data.header?.interviewer], ['Findings', (r) => counts[r.id] || 0],
    ['Red flags heard', (r) => Object.values(r.data.redFlags || {}).filter((x) => x && x.on).length],
    ['Checklist items ticked', (r) => Object.values(r.data.checklist || {}).filter(Boolean).length],
    ['Created by', (r) => r.createdBy], ['Updated at', (r) => r.updatedAt],
  ];
  audit(req, 'EXPORT', 'interviews', null, `CSV, ${rows.length} rows`);
  return { __csv: toCsv(H.map(([label, get]) => ({ label, get })), rows), filename: 'interviews.csv' };
});
route('POST', '/api/import', async (req) => {
  canEdit(req);
  const b = await readBody(req);
  const interviews = Array.isArray(b.interviews) ? b.interviews : [];
  const findings = Array.isArray(b.findings) ? b.findings : [];
  const services = Array.isArray(b.services) ? b.services : [];
  if (!interviews.length && !findings.length && !services.length) throw new HttpError(400, 'The file contains no interviews, findings or services.');
  const idMap = new Map(), svcMap = new Map();
  const result = { interviews: 0, findings: 0, services: 0, renumbered: [] };
  const mapSvc = (ids) => (Array.isArray(ids) ? [...new Set(ids.map((x) => svcMap.get(x)).filter(Boolean))] : []);
  db.exec('BEGIN');
  try {
    for (const sv of services) {
      if (!sv || typeof sv !== 'object') throw new HttpError(400, 'Invalid service record in file.');
      let ref = typeof sv.ref === 'string' && /^[\w-]{1,40}$/.test(sv.ref) ? sv.ref : null;
      if (!ref || db.prepare('SELECT 1 FROM services WHERE ref = ?').get(ref)) { const n = nextServiceRef(); if (ref) result.renumbered.push(`${ref} -> ${n}`); ref = n; }
      const r = db.prepare('INSERT INTO services (ref, data, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)')
        .run(ref, JSON.stringify(serviceData(sv)), sv.createdBy || req.user.username, sv.createdAt || now(), req.user.username, now());
      if (sv.id != null) svcMap.set(sv.id, Number(r.lastInsertRowid));
      result.services++;
    }
    for (const iv of interviews) {
      if (!iv || typeof iv.data !== 'object') throw new HttpError(400, 'Invalid interview record in file.');
      migrateInterviewData(iv.data); // files exported before permanent question IDs / several questionnaires
      if (!QN_IDS.includes(iv.data.questionnaireId)) throw new HttpError(400, `Interview ${iv.ref || ''} uses a questionnaire this app does not have ("${iv.data.questionnaireId}").`);
      let ref = typeof iv.ref === 'string' && /^[\w-]{1,40}$/.test(iv.ref) ? iv.ref : null;
      if (!ref || db.prepare('SELECT 1 FROM interviews WHERE ref = ?').get(ref)) { const n = nextRef('interviews', 'INT'); if (ref) result.renumbered.push(`${ref} -> ${n}`); ref = n; }
      if (iv.data.header && iv.data.header.serviceIds) iv.data.header.serviceIds = mapSvc(iv.data.header.serviceIds);
      const status = ['Draft', 'In progress', 'Complete', 'Archived'].includes(iv.status) ? iv.status : 'Draft';
      const r = db.prepare('INSERT INTO interviews (ref, status, data, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(ref, status, JSON.stringify(iv.data), iv.createdBy || req.user.username, iv.createdAt || now(), req.user.username, now());
      if (iv.id != null) idMap.set(iv.id, Number(r.lastInsertRowid));
      result.interviews++;
    }
    for (const f of findings) {
      if (!f || typeof f !== 'object') throw new HttpError(400, 'Invalid finding record in file.');
      let ref = typeof f.ref === 'string' && /^[\w-]{1,40}$/.test(f.ref) ? f.ref : null;
      if (!ref || db.prepare('SELECT 1 FROM findings WHERE ref = ?').get(ref)) { const n = nextRef('findings', 'TRF'); if (ref) result.renumbered.push(`${ref} -> ${n}`); ref = n; }
      const iid = f.interviewId != null && idMap.has(f.interviewId) ? idMap.get(f.interviewId) : (b.linkExisting ? validInterviewId(f.interviewId) : null);
      db.prepare('INSERT INTO findings (ref, interview_id, data, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(ref, iid, JSON.stringify({ ...findingData(f), ...(f.serviceIds ? { serviceIds: mapSvc(f.serviceIds) } : {}) }), f.createdBy || req.user.username, f.createdAt || now(), req.user.username, now());
      addFindingHistory(Number(db.prepare('SELECT last_insert_rowid() id').get().id), req.user.username, 'Imported', [{ f: 'source', from: '', to: String(b.source || 'import file').slice(0, 200) }]);
      result.findings++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(req, 'IMPORT', 'data', null, `${result.services ? result.services + ' services, ' : ''}${result.interviews} interviews, ${result.findings} findings${b.source ? ' from ' + b.source : ''}`);
  return result;
});
route('GET', '/api/export/database', (req) => {
  requireRole(req, 'admin');
  const tmp = path.join(os.tmpdir(), `tr-snapshot-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
  audit(req, 'EXPORT', 'database', null, 'Full database snapshot (includes user accounts and audit log)');
  return { __file: buf, filename: `tech-risk-db-${new Date().toISOString().slice(0, 10)}.db` };
});

// ----- evidence tracker -----
route('PATCH', '/api/interviews/:id/evidence', async (req, res, params) => {
  canEdit(req);
  const b = await readBody(req);
  const m = EVIDENCE_PATH.exec(String(b.path || ''));
  if (!m) throw new HttpError(400, 'Unknown evidence item.');
  const [, sid, kind, key] = m;
  const r = db.prepare('SELECT * FROM interviews WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Interview not found');
  const data = JSON.parse(r.data);
  if (!sectionInQn(data, sid)) throw new HttpError(400, "That section is not part of this interview's questionnaire.");
  const item = (((data.sections = data.sections || {})[sid] = data.sections[sid] || {})[kind] = data.sections[sid][kind] || {})[key] = data.sections[sid][kind][key] || {};
  const changed = [];
  for (const [k, v] of Object.entries(b.set || {})) {
    const field = EVIDENCE_FIELDS[kind][k]; if (!field) throw new HttpError(400, `Field ${k} cannot be changed here.`);
    if (k === 'status' && !EVIDENCE_STATUSES.includes(v)) throw new HttpError(400, 'Invalid status.');
    if (k === 'due' && v && !/^\d{4}-\d\d-\d\d$/.test(v)) throw new HttpError(400, 'Invalid date.');
    if (k === 'chases' && (!Array.isArray(v) || v.length > 100 || v.some((x) => !/^\d{4}-\d\d-\d\d/.test(String(x))))) throw new HttpError(400, 'Invalid chase log.');
    item[field] = k === 'chases' ? v.map(String) : String(v ?? '').slice(0, 4000);
    changed.push(k);
  }
  db.prepare('UPDATE interviews SET data = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), req.user.username, now(), r.id);
  audit(req, 'EVIDENCE_UPDATED', 'interview', r.ref, `${b.path}: ${changed.map((k) => `${k}=${k === 'chases' ? (b.set.chases || []).length + ' chase(s)' : b.set[k]}`).join(', ')}`);
  return { version: r.version + 1, item };
});

// ----- evidence files (fingerprinted with SHA-256 on upload, checked on every download) -----
const MAX_ATTACHMENT = 25 * 1024 * 1024;
const attachmentRow = (a) => ({ id: a.id, interviewId: a.interview_id, findingId: a.finding_id, path: a.item_path, filename: a.filename, size: a.size, sha256: a.sha256, note: a.note, uploadedBy: a.uploaded_by, uploadedAt: a.uploaded_at });
const FINDING_FILE_PATHS = ['closure', 'evidence'];
route('GET', '/api/attachments', (req, res, params, query) => {
  requireRole(req);
  const iid = query.get('interview'), fid = query.get('finding');
  const rows = iid ? db.prepare('SELECT * FROM attachments WHERE interview_id = ? ORDER BY id').all(Number(iid))
    : fid ? db.prepare('SELECT * FROM attachments WHERE finding_id = ? ORDER BY id').all(Number(fid))
      : db.prepare('SELECT * FROM attachments ORDER BY id').all();
  return rows.map(attachmentRow);
});
// Stores an uploaded file with its SHA-256 fingerprint. owner: { interviewId } or { findingId }.
async function storeAttachment(req, owner, itemPath) {
  const filename = decodeURIComponent(String(req.headers['x-file-name'] || 'evidence')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150) || 'evidence';
  const note = decodeURIComponent(String(req.headers['x-note'] || '')).slice(0, 500);
  const buf = await readRaw(req, MAX_ATTACHMENT);
  if (!buf.length) throw new HttpError(400, 'The file is empty.');
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  db.exec('BEGIN');
  let id;
  try {
    id = Number(db.prepare('INSERT INTO attachments (interview_id, finding_id, item_path, filename, size, sha256, note, uploaded_by, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(owner.interviewId || null, owner.findingId || null, itemPath, filename, buf.length, hash, note || null, req.user.username, now()).lastInsertRowid);
    db.prepare('INSERT INTO attachment_blobs (attachment_id, content) VALUES (?,?)').run(id, buf);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
}
route('POST', '/api/interviews/:id/attachments', async (req, res, params) => {
  canEdit(req);
  const iv = db.prepare('SELECT id, ref, data FROM interviews WHERE id = ?').get(Number(params.id));
  if (!iv) throw new HttpError(404, 'Interview not found');
  const itemPath = decodeURIComponent(String(req.headers['x-item-path'] || ''));
  const pm = EVIDENCE_PATH.exec(itemPath);
  if (!pm || !sectionInQn(JSON.parse(iv.data), pm[1])) throw new HttpError(400, 'Unknown evidence item.');
  const a = await storeAttachment(req, { interviewId: iv.id }, itemPath);
  audit(req, 'EVIDENCE_FILE_ADDED', 'interview', iv.ref, `${itemPath}: ${a.filename} (${a.size} bytes, SHA-256 ${a.sha256})`);
  return attachmentRow(a);
});
route('POST', '/api/findings/:id/attachments', async (req, res, params) => {
  canEdit(req);
  const f = db.prepare('SELECT id, ref FROM findings WHERE id = ?').get(Number(params.id));
  if (!f) throw new HttpError(404, 'Finding not found');
  const itemPath = decodeURIComponent(String(req.headers['x-item-path'] || 'closure'));
  if (!FINDING_FILE_PATHS.includes(itemPath)) throw new HttpError(400, 'Unknown file type.');
  const a = await storeAttachment(req, { findingId: f.id }, itemPath);
  addFindingHistory(f.id, req.user.username, 'File attached', [{ f: itemPath === 'closure' ? 'closure evidence file' : 'evidence file', from: '', to: `${a.filename} (SHA-256 ${a.sha256})` }]);
  audit(req, 'EVIDENCE_FILE_ADDED', 'finding', f.ref, `${itemPath}: ${a.filename} (${a.size} bytes, SHA-256 ${a.sha256})`);
  return attachmentRow(a);
});
const attachmentOwnerRef = (a) => (a.interview_id ? db.prepare('SELECT ref FROM interviews WHERE id = ?').get(a.interview_id)?.ref : db.prepare('SELECT ref FROM findings WHERE id = ?').get(a.finding_id)?.ref);
function checkAttachment(id) {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(id));
  if (!a) throw new HttpError(404, 'File not found');
  const blob = db.prepare('SELECT content FROM attachment_blobs WHERE attachment_id = ?').get(a.id);
  const content = blob ? Buffer.from(blob.content) : Buffer.alloc(0);
  const actual = crypto.createHash('sha256').update(content).digest('hex');
  return { a, content, actual, ok: !!blob && actual === a.sha256 };
}
route('GET', '/api/attachments/:id/verify', (req, res, params) => {
  requireRole(req);
  const { a, actual, ok } = checkAttachment(params.id);
  return { ok, expected: a.sha256, actual };
});
route('GET', '/api/attachments/:id/download', (req, res, params, query) => {
  requireRole(req);
  const { a, content, ok } = checkAttachment(params.id);
  if (!ok && query.get('anyway') !== '1') throw new HttpError(409, 'This file no longer matches the fingerprint taken when it was uploaded. It may have been altered or damaged.');
  audit(req, 'EVIDENCE_FILE_DOWNLOADED', a.interview_id ? 'interview' : 'finding', attachmentOwnerRef(a), `${a.filename}${ok ? '' : ' (FINGERPRINT MISMATCH - downloaded anyway)'}`);
  return { __file: content, filename: a.filename };
});
route('DELETE', '/api/attachments/:id', (req, res, params) => {
  requireRole(req, 'admin');
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(params.id));
  if (!a) throw new HttpError(404, 'File not found');
  const ref = attachmentOwnerRef(a);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  if (a.finding_id) addFindingHistory(a.finding_id, req.user.username, 'File deleted', [{ f: 'file', from: `${a.filename} (SHA-256 ${a.sha256})`, to: '' }]);
  audit(req, 'EVIDENCE_FILE_DELETED', a.interview_id ? 'interview' : 'finding', ref, `${a.item_path}: ${a.filename} (SHA-256 ${a.sha256}, uploaded by ${a.uploaded_by} ${a.uploaded_at})`);
  return { ok: true };
});

// ----- programme-level documents (CTO briefing wording) -----
const APP_DOCS = ['briefing', 'board', 'compliance', 'technology', 'finance']; // editable report wording
route('GET', '/api/docs/:id', (req, res, params) => {
  requireRole(req);
  if (!APP_DOCS.includes(params.id)) throw new HttpError(404, 'Unknown document');
  const r = db.prepare('SELECT * FROM app_docs WHERE id = ?').get(params.id);
  return r ? { data: JSON.parse(r.data), version: r.version, updatedBy: r.updated_by, updatedAt: r.updated_at } : { data: {}, version: 0 };
});
route('PUT', '/api/docs/:id', async (req, res, params) => {
  canEdit(req);
  if (!APP_DOCS.includes(params.id)) throw new HttpError(404, 'Unknown document');
  const b = await readBody(req);
  if (!b.data || typeof b.data !== 'object') throw new HttpError(400, 'Invalid document');
  const r = db.prepare('SELECT * FROM app_docs WHERE id = ?').get(params.id);
  if ((r ? r.version : 0) !== b.version) throw new HttpError(409, `This was changed by ${r?.updated_by} at ${r?.updated_at}. Reload to see the latest version.`);
  if (r) db.prepare('UPDATE app_docs SET data = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(b.data), req.user.username, now(), params.id);
  else db.prepare('INSERT INTO app_docs (id, data, version, updated_by, updated_at) VALUES (?,?,1,?,?)').run(params.id, JSON.stringify(b.data), req.user.username, now());
  audit(req, 'DOC_UPDATED', 'doc', params.id);
  const n = db.prepare('SELECT * FROM app_docs WHERE id = ?').get(params.id);
  return { version: n.version, updatedBy: n.updated_by, updatedAt: n.updated_at };
});

// ----- business services register -----
route('GET', '/api/services', (req) => {
  requireRole(req);
  return db.prepare('SELECT * FROM services ORDER BY ref').all().map(rowService);
});
route('POST', '/api/services', async (req) => {
  canEdit(req);
  const data = serviceData(await readBody(req));
  const ref = nextServiceRef();
  const r = db.prepare('INSERT INTO services (ref, data, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?)').run(ref, JSON.stringify(data), req.user.username, now(), req.user.username, now());
  audit(req, 'SERVICE_CREATED', 'service', ref, data.name);
  return rowService(db.prepare('SELECT * FROM services WHERE id = ?').get(Number(r.lastInsertRowid)));
});
route('PUT', '/api/services/:id', async (req, res, params) => {
  canEdit(req);
  const b = await readBody(req);
  const r = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Service not found');
  if (b.version !== r.version) throw new HttpError(409, `This service was changed by ${r.updated_by} at ${r.updated_at}. Reload to see the latest version.`);
  const before = JSON.parse(r.data), data = serviceData(b);
  db.prepare('UPDATE services SET data = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), req.user.username, now(), r.id);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(data)])].filter((k) => JSON.stringify(before[k] ?? '') !== JSON.stringify(data[k] ?? ''));
  audit(req, 'SERVICE_UPDATED', 'service', r.ref, changed.length ? 'Changed: ' + changed.join(', ') : 'No changes');
  return rowService(db.prepare('SELECT * FROM services WHERE id = ?').get(r.id));
});
// Deleting a service removes its links from interviews and findings (the records themselves are kept).
route('DELETE', '/api/services/:id', (req, res, params) => {
  requireRole(req, 'admin');
  const r = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(params.id));
  if (!r) throw new HttpError(404, 'Service not found');
  let unlinked = 0;
  db.exec('BEGIN');
  try {
    for (const iv of db.prepare('SELECT id, data FROM interviews').all()) {
      const d = JSON.parse(iv.data); const ids = d.header?.serviceIds || [];
      if (ids.includes(r.id)) { d.header.serviceIds = ids.filter((x) => x !== r.id); db.prepare('UPDATE interviews SET data = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(d), iv.id); unlinked++; }
    }
    for (const fd of db.prepare('SELECT id, data FROM findings').all()) {
      const d = JSON.parse(fd.data); const ids = d.serviceIds || [];
      if (ids.includes(r.id)) { d.serviceIds = ids.filter((x) => x !== r.id); db.prepare('UPDATE findings SET data = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(d), fd.id); addFindingHistory(fd.id, req.user.username, 'Updated', [{ f: 'serviceIds', from: r.ref, to: '(service deleted)' }]); unlinked++; }
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(r.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(req, 'SERVICE_DELETED', 'service', r.ref, `${JSON.parse(r.data).name}; unlinked from ${unlinked} record(s)`);
  return { ok: true, unlinked };
});
route('GET', '/api/export/services.csv', (req) => {
  requireRole(req, 'admin', 'assessor');
  const rows = db.prepare('SELECT * FROM services ORDER BY ref').all().map(rowService);
  const H = [['Ref', 'ref'], ['Service', 'name'], ['Designation', 'designation'], ['Description', 'description'], ['Customers / users', 'customers'], ['Business owner', 'owner'],
    ['Accountable senior manager', 'accountableSmf'], ['Regulators', 'regulators'], ['Impact tolerance', 'toleranceText'], ['Tolerance (hours)', 'toleranceHours'], ['Other tolerance metrics', 'otherMetrics'],
    ['People / teams', 'people'], ['Processes', 'processes'], ['Technology', 'technology'], ['Suppliers', 'suppliers'], ['Facilities', 'facilities'], ['Information / data', 'data'],
    ['Last scenario test', 'scenarioTestDate'], ['Scenario test result', 'scenarioResult'], ['Known vulnerabilities', 'vulnerabilities'], ['Last reviewed', 'reviewDate'], ['Approved by', 'approvedBy'], ['Status', 'status']];
  audit(req, 'EXPORT', 'services', null, `CSV, ${rows.length} rows`);
  return { __csv: toCsv(H.map(([label, k]) => ({ label, get: (r) => r[k] })), rows), filename: 'business-services.csv' };
});

// ----- demonstration data (loaded through /api/import with data.demo = true) -----
route('POST', '/api/demo/remove', (req) => {
  canEdit(req);
  const ivs = db.prepare("SELECT id FROM interviews WHERE json_extract(data, '$.demo') = 1").all();
  const fs = db.prepare("SELECT id FROM findings WHERE json_extract(data, '$.demo') = 1").all();
  const svcs = db.prepare("SELECT id FROM services WHERE json_extract(data, '$.demo') = 1").all();
  db.exec('BEGIN');
  try {
    fs.forEach((f) => db.prepare('DELETE FROM findings WHERE id = ?').run(f.id));
    ivs.forEach((i) => db.prepare('DELETE FROM interviews WHERE id = ?').run(i.id));
    svcs.forEach((x) => db.prepare('DELETE FROM services WHERE id = ?').run(x.id));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(req, 'DEMO_REMOVED', 'data', null, `${ivs.length} demo interviews, ${fs.length} demo findings, ${svcs.length} demo services`);
  return { interviews: ivs.length, findings: fs.length, services: svcs.length };
});

// ----- backups (admin) -----
route('GET', '/api/backup/status', (req) => { requireRole(req, 'admin'); return backupStatus(); });
route('GET', '/api/backup/list', (req) => { requireRole(req, 'admin'); return { backups: listBackups(), log: readBackupLog(30) }; });
route('PUT', '/api/backup/settings', async (req) => {
  requireRole(req, 'admin');
  const b = await readBody(req);
  const cur = getBackupSettings();
  const next = {
    enabled: b.enabled === undefined ? cur.enabled : !!b.enabled,
    dir: b.dir === undefined ? cur.dir : String(b.dir).trim().replace(/[\\/]+$/, ''),
    intervalHours: Math.min(168, Math.max(1, Math.round(Number(b.intervalHours ?? cur.intervalHours)) || 24)),
    retention: Math.min(365, Math.max(3, Math.round(Number(b.retention ?? cur.retention)) || 30)),
  };
  try { prepareBackupDir(next.dir); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, `Cannot use that folder: ${e.message}`); }
  fs.writeFileSync(BACKUP_SETTINGS_FILE, JSON.stringify(next, null, 2));
  audit(req, 'BACKUP_SETTINGS', 'backup', null, JSON.stringify(next));
  return backupStatus();
});
route('POST', '/api/backup/run', (req) => {
  requireRole(req, 'admin');
  const r = runBackup('manual', req.user.username);
  audit(req, 'BACKUP', 'backup', r.file, `${r.interviews} interviews, ${r.findings} findings -> ${r.dir}`);
  return r;
});
route('POST', '/api/backup/restore', async (req) => {
  requireRole(req, 'admin');
  const b = await readBody(req);
  const s = getBackupSettings();
  if (!BACKUP_RE.test(String(b.file || ''))) throw new HttpError(400, 'Choose a backup from the list.');
  const full = path.join(s.dir, b.file);
  if (!fs.existsSync(full)) throw new HttpError(404, 'That backup file no longer exists.');
  try { if (fs.readFileSync(full + '.sha256', 'utf8').split(/\s+/)[0] !== fileSha256(full)) throw new HttpError(400, 'This backup has changed since it was taken (fingerprint mismatch) and will not be restored.'); }
  catch (e) { if (e instanceof HttpError) throw e; /* no fingerprint file - integrity check still applies */ }
  return restoreFromFile(full, req, b.file);
});
route('POST', '/api/backup/restore-upload', async (req) => {
  requireRole(req, 'admin');
  const name = String(req.headers['x-file-name'] || 'uploaded.db').replace(/[^\w.\- ]/g, '_').slice(0, 100);
  const tmp = path.join(os.tmpdir(), `tr-upload-${Date.now()}.db`);
  try {
    fs.writeFileSync(tmp, await readRaw(req, 500 * 1024 * 1024));
    return restoreFromFile(tmp, req, 'upload: ' + name);
  } finally { fs.rmSync(tmp, { force: true }); }
});

route('GET', '/api/audit', (req, res, params, query) => {
  requireRole(req, 'admin');
  const limit = Math.min(Number(query.get('limit')) || 500, 5000);
  return db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit);
});

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url.pathname);
    }
    // CSRF defence: state-changing API calls must carry a custom header (cannot be sent cross-site without CORS) and same-origin cookie.
    if (req.method !== 'GET' && req.headers['x-tr-request'] !== '1') throw new HttpError(403, 'Missing request header');
    req.user = loadSession(req);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      const out = await r.handler(req, res, params, url.searchParams);
      // Always a download (never rendered in the browser); ASCII fallback plus RFC 5987 UTF-8 name.
      const disposition = (name) => `attachment; filename="${String(name).replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
      if (out && out.__csv !== undefined) return send(res, 200, out.__csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': disposition(out.filename) });
      if (out && out.__file) return send(res, 200, out.__file, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': disposition(out.filename) });
      return send(res, 200, out ?? { ok: true });
    }
    throw new HttpError(404, 'Unknown API route');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Internal error - see the server window for details.' });
  }
});

// Purge expired sessions hourly.
setInterval(() => db.prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?')
  .run(Date.now() - IDLE_MINUTES * 60e3, Date.now() - ABSOLUTE_HOURS * 3600e3), 3600e3).unref();

// Start-up: validate question IDs, upgrade old saved answers, then check backups every 10 minutes
// (a missed daily backup - e.g. the laptop was off - is taken shortly after the app next starts).
checkContentIds();
migrateLegacyInterviews();
setTimeout(scheduledBackupCheck, 60e3).unref();
setInterval(scheduledBackupCheck, 10 * 60e3).unref();

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Technology Risk Interview App');
  console.log(`  Running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Data folder: ${DATA_DIR}`);
  const bk = getBackupSettings();
  console.log(`  Backups: ${bk.enabled ? `${bk.dir} (every ${bk.intervalHours}h, keeping ${bk.retention})` : 'AUTOMATIC BACKUPS ARE OFF'}`);
  console.log(`  Questionnaire version: ${CONTENT_VERSION} (${Object.values(QN_TITLES).join(', ')})`);
  console.log('  Keep this window open while using the app. Press Ctrl+C to stop.');
  console.log('');
});
