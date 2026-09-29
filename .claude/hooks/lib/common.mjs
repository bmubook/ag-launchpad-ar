/**
 * أدوات مشتركة لـ Hooks القالب (AG Launchpad AR — Claude Code).
 * بلا اعتماديات خارجية، متوافقة مع Node.js 18+ على Windows (Git Bash) و macOS و Linux.
 * كل Hook يعمل بمبدأ "الفشل المفتوح": أي خطأ داخلي لا يوقف جلسة المستخدم.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';

export const GOVERNANCE_FILES = [
  'master_rules.md', 'rules_security.md', 'rules_code_quality.md', 'rules_workflow.md',
  'rules_ui.md', 'project_map.md', 'changelog.md', 'bugs_log.md', 'decisions_log.md',
];

const STATE_DIR = '.claude/state';
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function projectDir() {
  return resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

export function readStdinJson() {
  return new Promise((done) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => {
      try { done(raw.trim() ? JSON.parse(raw) : {}); } catch { done({}); }
    });
    process.stdin.on('error', () => done({}));
  });
}

export function readProjectFile(relPath) {
  try { return readFileSync(join(projectDir(), relPath), 'utf8'); } catch { return null; }
}

/** مسار نسبي موحّد بشرطات أمامية، أو null إذا كان الملف خارج المشروع. */
export function toProjectRelative(filePath) {
  if (!filePath) return null;
  const abs = resolve(projectDir(), String(filePath));
  const rel = relative(projectDir(), abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || /^[a-zA-Z]:/.test(rel)) return null;
  return rel;
}

const ANCHORS = {
  projectName: /\*\*اسم المشروع:\*\*[ \t]*(.*)/,
  projectType: /\*\*طبيعة المشروع:\*\*[ \t]*(.*)/,
  callSign: /\*\*اسم النداء \(Call Sign\):\*\*[ \t]*(.*)/,
  mode: /\*\*وضع التشغيل النشط:\*\*[ \t]*(.*)/,
  phase: /\*\*المرحلة النشطة حالياً:\*\*[ \t]*(.*)/,
  experience: /\*\*مستوى الخبرة:\*\*[ \t]*(.*)/,
  learning: /\*\*وضع التعلّم:\*\*[ \t]*(.*)/,
  suggestions: /\*\*اقتراحات التطوير:\*\*[ \t]*(.*)/,
};

function cleanValue(value) {
  const v = (value || '').trim();
  return !v || v.startsWith('[') ? null : v;
}

/** مفعّل/معطّل مع تجاهل التشكيل (مفعل = مفعّل). null إذا لم يُحدَّد بعد. */
function toggleValue(value) {
  const plain = (value || '').replace(/[ً-ْ]/g, '');
  if (/معطل/.test(plain)) return false;
  if (/مفعل/.test(plain)) return true;
  return null;
}

/** يقرأ مراسي project_map.md (الاسم، الطبيعة، اسم النداء، الوضع، المرحلة، التعلّم، الاقتراحات). */
export function readProjectState() {
  const map = readProjectFile('project_map.md') || '';
  const state = {};
  for (const [key, re] of Object.entries(ANCHORS)) {
    const match = map.match(re);
    state[key] = cleanValue(match && match[1]);
  }
  state.mode = /prototype/i.test(state.mode || '') ? 'prototype' : 'production';
  state.learning = toggleValue(state.learning);
  state.suggestions = toggleValue(state.suggestions);
  state.backlogOpen = tableRows(map, /أفكار التطوير المستقبلية/)
    .filter((cells) => /⬜|🟡/.test(cells[cells.length - 1] || '')).length;
  state.kickedOff = Boolean(state.projectName);
  state.mapFound = map.length > 0;
  return state;
}

/** صفوف جدول Markdown الأول بعد عنوان يطابق headingRe (دون صف العناوين والفاصل). */
export function tableRows(markdown, headingRe) {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && headingRe.test(line));
  if (start === -1) return [];
  const rows = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    const isRow = line.trim().startsWith('|');
    if (!isRow && inTable) break;
    if (!isRow && /^#{1,6}\s/.test(line)) break;
    if (isRow) { inTable = true; rows.push(line.trim()); }
  }
  return rows.slice(2).map(splitRow).filter((cells) => !cells.some((c) => c.includes('لا توجد')));
}

function splitRow(row) {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function truncate(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function sessionFile(sessionId) {
  const safeId = String(sessionId || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'default';
  return join(projectDir(), STATE_DIR, `session-${safeId}.json`);
}

export function loadSession(sessionId) {
  try {
    const data = JSON.parse(readFileSync(sessionFile(sessionId), 'utf8'));
    return {
      prompts: Number(data.prompts) || 0,
      edited: Array.isArray(data.edited) ? data.edited : [],
      warned: data.warned && typeof data.warned === 'object' ? data.warned : {},
    };
  } catch {
    return { prompts: 0, edited: [], warned: {} };
  }
}

export function saveSession(sessionId, data) {
  try {
    mkdirSync(join(projectDir(), STATE_DIR), { recursive: true });
    writeFileSync(sessionFile(sessionId), JSON.stringify(data), 'utf8');
  } catch { /* الحالة اختيارية: الفشل هنا لا يوقف الجلسة */ }
}

/** حذف ملفات الحالة الأقدم من 7 أيام لإبقاء المجلد نظيفاً. */
export function pruneOldSessions() {
  const dir = join(projectDir(), STATE_DIR);
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name.startsWith('session-') && Date.now() - statSync(full).mtimeMs > STATE_MAX_AGE_MS) unlinkSync(full);
    }
  } catch { /* المجلد غير موجود بعد */ }
}

const DOC_EXTENSIONS = /\.(md|mdx|markdown|txt)$/i;
// إعدادات شخصية مستثناة من Git: تغييرها لا يغيّر المشروع فلا يستوجب مدخلاً في changelog
const PERSONAL_FILES = /^\.claude\/settings\.local\.json$/;

/** هل الملف "كود" يستوجب التوثيق؟ (ليس Markdown ولا من ملفات الحالة الداخلية ولا إعدادات شخصية) */
export function isCodeFile(relPath) {
  if (!relPath) return false;
  if (relPath.startsWith(`${STATE_DIR}/`) || PERSONAL_FILES.test(relPath)) return false;
  return !DOC_EXTENSIONS.test(relPath);
}

/** ملفات البيئة الحقيقية (.env و .env.local ...) باستثناء القوالب العامة. */
export function isRealEnvFile(filePath) {
  const name = basename(String(filePath || '').replace(/\\/g, '/'));
  return /^\.env(\..+)?$/i.test(name) && !/^\.env\.(example|sample|template|dist)$/i.test(name);
}

/** ملف حساب خدمة Firebase/Google (سرّ كامل الصلاحيات) مثل <project>-firebase-adminsdk-xxxx.json. */
export function isServiceAccountFile(filePath) {
  const name = basename(String(filePath || '').replace(/\\/g, '/'));
  return /(adminsdk|service[-_]?account)[^/]*\.json$/i.test(name);
}

export function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
}

export function addContext(hookEventName, additionalContext) {
  emit({ hookSpecificOutput: { hookEventName, additionalContext } });
}

/** تشغيل آمن: أي استثناء غير متوقع يُنهي الـ Hook بنجاح دون تعطيل الجلسة. */
export function runHook(main) {
  main().then(() => process.exit(0), () => process.exit(0));
}
