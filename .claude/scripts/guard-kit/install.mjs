/**
 * تركيب حقيبة الحارس في مشروع قائم وتحديثها وإزالتها (يستدعيها guard-install.mjs).
 * تنسخ طبقة الإنفاذ من هذا القالب إلى .claude/launchpad/، وتدمج إعداداتها، وتضيف قواعد الوكيل القصيرة.
 * لا تمس كود المشروع ولا CLAUDE.md؛ وكل ما تضيفه مسجّل في manifest.json لتُزيله --remove وحده.
 */
import {
  cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectChecks } from '../../hooks/lib/checks.mjs';
import { kitSettings, mergeSettings, removeSettings } from './settings.mjs';

export const TEMPLATE = fileURLToPath(new URL('../../../', import.meta.url));
export const KIT_DIR = '.claude/launchpad';
export const RULES_FILE = '.claude/rules/launchpad-guard.md';
export const CONFIG_FILE = '.claude/launchpad.json';
const SETTINGS_FILE = '.claude/settings.json';
const MANIFEST_FILE = `${KIT_DIR}/manifest.json`;
const STATE_DIR = '.claude/state';
const SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';
const GITIGNORE_BLOCK = ['# AG Launchpad — حالة الحارس المحلية (لا تُرفع)', '.claude/state/'];
const ALREADY_IGNORED = /^\/?\.claude(\/state)?\/?[ \t]*$/m;
// ما يُنسخ من القالب: [المصدر، الهدف داخل المشروع]. الخارطة والمهارات والملفات الحاكمة تبقى للقالب الكامل
const PAYLOAD = [
  ['.claude/hooks', `${KIT_DIR}/hooks`],
  ['.claude/scripts/verify.mjs', `${KIT_DIR}/scripts/verify.mjs`],
  ['.claude/statusline.mjs', `${KIT_DIR}/statusline.mjs`],
];
// كل ما يُكتب أو يُحذف: لا يُتبع رابط رمزي في أي منها حتى لا تمتد الكتابة خارج المشروع
const WRITTEN_PATHS = [
  '.claude', KIT_DIR, `${KIT_DIR}/hooks`, `${KIT_DIR}/scripts`, `${KIT_DIR}/statusline.mjs`, MANIFEST_FILE,
  '.claude/rules', RULES_FILE, SETTINGS_FILE, CONFIG_FILE, STATE_DIR, '.gitignore',
];

export const DEFAULT_CONFIG = {
  _help: 'mode: production أو prototype — ceilings: تنبيه سقف حجم الملفات (true أو false) — checks: أوامر الفحص مثل [{"step": "test", "run": "pytest -q"}]، وتركها فارغة يعني الاكتشاف التلقائي',
  mode: 'production',
  ceilings: false,
  checks: [],
};

/** خطأ يُعرض لصاحب المشروع كما هو، دون تتبع برمجي. */
export class KitError extends Error {}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const readJsonFile = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const isLink = (path) => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };
const list = (dir) => { try { return readdirSync(dir); } catch { return []; } };
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** إصدار القالب: آخر مدخل في سجل تطويره (يصلح لنسخة git clone ولملف zip معاً). */
export function templateVersion() {
  const logPath = join(TEMPLATE, 'docs', 'template-changelog.md');
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  const versions = [...log.matchAll(/\|\s*v(\d+\.\d+\.\d+)\s*\|/g)];
  return versions.length ? versions[versions.length - 1][1] : '0.0.0';
}

/** هل child هو parent نفسه أو داخله؟ (relative في Windows لا يفرّق بين حالة الأحرف) */
function isWithin(parent, child) {
  const rel = relative(parent, child);
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}

function checkTarget(target) {
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new KitError(`لم أجد مجلد المشروع: ${target}`);
  // ~/.claude هو مجلد إعدادات Claude Code العامة: التركيب فيه يفرض الحواجز على كل مشاريع الجهاز
  if (!relative(homedir(), target) || parse(target).root === target) {
    throw new KitError('هذا مجلدك الشخصي أو جذر القرص، وفيه إعدادات Claude Code لكل مشاريعك. ركّب الحقيبة في مجلد مشروع واحد.');
  }
  if (isWithin(TEMPLATE, target)) {
    throw new KitError('هذا مجلد القالب نفسه أو مجلد داخله. ركّب الحقيبة في مشروعك: node .claude/scripts/guard-install.mjs <مسار مشروعك>');
  }
  if (isWithin(join(target, KIT_DIR), TEMPLATE)) throw new KitError(`القالب نفسه داخل ${KIT_DIR} في هذا المشروع؛ انقله إلى مكان آخر أولاً.`);
  if (existsSync(join(target, 'master_rules.md')) && existsSync(join(target, '.claude', 'hooks', 'stop-gate.mjs'))) {
    throw new KitError('هذا المشروع يعمل بالقالب الكامل، وحواجزه فيه أصلاً؛ لا حاجة إلى الحقيبة.');
  }
  const link = WRITTEN_PATHS.find((rel) => isLink(join(target, rel)));
  if (link) throw new KitError(`${link} رابط رمزي (symlink)، فلا أكتب عبره احتياطاً. أزل الرابط ثم أعد الأمر.`);
}

/** إعدادات المشروع، أو null إن لم توجد. ملف تالف، أو بشكل لا تفهمه الحقيبة، يوقف كل شيء قبل أي تغيير. */
function readSettings(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  let value = null;
  try { value = JSON.parse(text); } catch { value = null; }
  if (!isObject(value)) throw new KitError(`${SETTINGS_FILE} ليس JSON صالحاً، فلم أغيّر شيئاً. أصلحه ثم أعد الأمر.`);
  assertSettingsShape(value);
  return value;
}

/** hooks كائن قوائم، و permissions كائن قوائم: غير ذلك لا يُدمج فيه ولا يُحذف منه شيء. */
function assertSettingsShape(settings) {
  const unexpected = (field) => new KitError(`${SETTINGS_FILE}: الحقل ${field} بشكل غير متوقع، فلم أغيّر شيئاً. أصلحه ثم أعد الأمر.`);
  if (settings.hooks !== undefined && !isObject(settings.hooks)) throw unexpected('hooks');
  for (const [event, groups] of Object.entries(settings.hooks || {})) if (!Array.isArray(groups)) throw unexpected(`hooks.${event}`);
  if (settings.permissions !== undefined && !isObject(settings.permissions)) throw unexpected('permissions');
  for (const key of ['allow', 'deny', 'ask']) {
    if (settings.permissions?.[key] !== undefined && !Array.isArray(settings.permissions[key])) throw unexpected(`permissions.${key}`);
  }
}

/** يضيف سطر .claude/state/ إلى .gitignore إن لم يكن متجاهَلاً. خارج مستودع Git بلا .gitignore لا يُنشأ ملف. */
function addGitignoreBlock(target) {
  const path = join(target, '.gitignore');
  const exists = existsSync(path);
  if (!exists && !existsSync(join(target, '.git'))) return false;
  const text = exists ? readFileSync(path, 'utf8') : '';
  if (ALREADY_IGNORED.test(text)) return false;
  const separator = !text ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(path, `${text}${separator}${GITIGNORE_BLOCK.join('\n')}\n`);
  return true;
}

function removeGitignoreBlock(target, createdFile) {
  const path = join(target, '.gitignore');
  if (!existsSync(path)) return;
  const block = new RegExp(`(\\r?\\n)?${GITIGNORE_BLOCK.map(escapeRegex).join('\\r?\\n')}\\r?\\n?`);
  const text = readFileSync(path, 'utf8').replace(block, '');
  if (createdFile && !text.trim()) rmSync(path, { force: true });
  else writeFileSync(path, text);
}

function removeIfEmpty(dir) {
  try {
    if (!readdirSync(dir).length) rmdirSync(dir);
  } catch { /* المجلد غير موجود أو غير فارغ: يبقى كما هو */ }
}

/** ملفات الحالة التي تكتبها Hooks الحقيبة وحدها. */
function removeState(target) {
  const dir = join(target, STATE_DIR);
  for (const name of list(dir)) if (name === 'quality.json' || /^session-.+\.json$/.test(name)) rmSync(join(dir, name), { force: true });
  removeIfEmpty(dir);
}

const sameConfig = (a, b) => isObject(a) && ['mode', 'ceilings', 'checks'].every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));

/** يركّب الحقيبة أو يحدّثها. يعيد ما يلزم لملخص المستخدم، ومنه أوامر الفحص التي اكتُشفت. */
export function install(target) {
  checkTarget(target);
  const previous = readJsonFile(join(target, MANIFEST_FILE)) || {};
  // مجلد بالاسم نفسه لم تركّبه الحقيبة: لا يُحذف منه شيء ولا يُكتب فوقه
  if (!previous.version && list(join(target, KIT_DIR)).length) {
    throw new KitError(`${KIT_DIR} موجود في المشروع وليس من تركيب سابق للحقيبة (لا manifest.json فيه)، فلم أغيّر شيئاً. انقله أو أعد تسميته ثم أعد الأمر.`);
  }
  const settingsPath = join(target, SETTINGS_FILE);
  const existing = readSettings(settingsPath);
  const templateSettings = readJsonFile(join(TEMPLATE, SETTINGS_FILE));
  if (!isObject(templateSettings)) throw new KitError('لم أجد إعدادات القالب (.claude/settings.json). حمّل القالب كاملاً ثم أعد المحاولة.');
  const created = previous.created || {
    claudeDir: !existsSync(join(target, '.claude')),
    rulesDir: !existsSync(join(target, '.claude', 'rules')),
    settings: !existing,
    config: !existsSync(join(target, CONFIG_FILE)),
    gitignore: !existsSync(join(target, '.gitignore')),
  };
  const { settings, added } = mergeSettings(existing || {}, kitSettings(templateSettings), previous.added);

  // التحديث يستبدل الحواجز كلها، فلا يبقى ملف حذفه القالب في إصدار أحدث
  for (const dir of ['hooks', 'scripts']) rmSync(join(target, KIT_DIR, dir), { recursive: true, force: true });
  for (const [from, to] of PAYLOAD) {
    mkdirSync(dirname(join(target, to)), { recursive: true });
    cpSync(join(TEMPLATE, from), join(target, to), { recursive: true });
  }
  mkdirSync(join(target, '.claude', 'rules'), { recursive: true });
  writeFileSync(join(target, RULES_FILE), readFileSync(join(TEMPLATE, '.claude', 'scripts', 'guard-kit', 'guard-rules.md'), 'utf8'));
  const configCreated = !existsSync(join(target, CONFIG_FILE));
  if (configCreated) writeJson(join(target, CONFIG_FILE), DEFAULT_CONFIG);
  writeJson(settingsPath, existing ? settings : { $schema: SCHEMA, ...settings });
  const gitignoreAdded = addGitignoreBlock(target);
  const version = templateVersion();
  const now = new Date().toISOString();
  writeJson(join(target, MANIFEST_FILE), {
    version, installedAt: previous.installedAt || now, updatedAt: now, created, added, gitignore: gitignoreAdded || Boolean(previous.gitignore),
  });
  return {
    version, previousVersion: previous.version || null, configCreated, gitignoreAdded,
    ownStatusLine: Boolean(existing?.statusLine) && !added.statusLine, checks: detectChecks(target),
  };
}

/** يزيل الحقيبة وكل ما أضافته؛ إعدادات صاحب المشروع وملف أوامره المعدّل يبقيان. */
export function remove(target) {
  checkTarget(target);
  const manifest = readJsonFile(join(target, MANIFEST_FILE));
  if (!isObject(manifest)) throw new KitError(`لم أجد حقيبة الحارس في هذا المشروع (${MANIFEST_FILE}).`);
  const settingsPath = join(target, SETTINGS_FILE);
  const existing = readSettings(settingsPath);
  if (existing) {
    const cleaned = removeSettings(existing, manifest.added);
    if (manifest.created?.settings && Object.keys(cleaned).every((key) => key === '$schema')) rmSync(settingsPath, { force: true });
    else writeJson(settingsPath, cleaned);
  }
  rmSync(join(target, KIT_DIR), { recursive: true, force: true });
  rmSync(join(target, RULES_FILE), { force: true });
  removeState(target);
  if (manifest.gitignore) removeGitignoreBlock(target, manifest.created?.gitignore);
  const configPath = join(target, CONFIG_FILE);
  if (manifest.created?.config && sameConfig(readJsonFile(configPath), DEFAULT_CONFIG)) rmSync(configPath, { force: true });
  if (manifest.created?.rulesDir) removeIfEmpty(join(target, '.claude', 'rules'));
  if (manifest.created?.claudeDir) removeIfEmpty(join(target, '.claude'));
  return { configKept: existsSync(configPath) };
}
