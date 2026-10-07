/**
 * حواجز حتمية ضد ما يحاوله وكيل خدعه نص مدسوس (البندان 5 و 6 — rules_security.md).
 * لا تمنع النموذج من تصديق النص، بل توقف ما يحاول فعله بعده: تنزيل سكربت وتشغيله، تعطيل طبقة
 * الحماية بأمر طرفية، قراءة مخازن المفاتيح، ورفع ملفات إلى الخارج.
 * القرار ask يوقف الإجراء حتى يوافق المستخدم؛ وفي أداة بلا نافذة موافقة يتحول إلى منع (lib/host.mjs).
 * الكشف بالصيغ المباشرة فقط: أمر يخفي مساره في متغير يفلت منه — حد معروف توثّقه tests/attacks.test.mjs.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectDir, toProjectRelative } from './common.mjs';
import {
  DOTNET_FILE_WRITE, DOWNLOAD_TO_SCRIPT, INLINE_WRITE, KEYCHAIN_READ, KEY_MATERIAL, LOCAL_HOST, MAX_COMMAND_CHARS, MUTATING_COMMANDS, MUTATING_GIT,
  PROJECT_KEY_FILES, PROTECTED_DIRS, PROTECTED_INSTRUCTION_PATHS, READ_OR_EXFIL_COMMAND, REMOTE_EXEC, SCRIPT_INTERPRETERS, SCRIPT_RUNNER,
  SECRET_STORES, SHELL_WRAPPERS, UPLOAD, URL_HOST,
} from './patterns.mjs';
import { assignedValues, expandVariables } from './shell-vars.mjs';

const SEVERITY = { allow: 0, ask: 1, deny: 2 };
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Delete']);
const PREFIX_WORDS = /^(?:sudo|command|env|time|nohup)$|^\w+=/;

export function decide(permissionDecision, reason) {
  return { permissionDecision, reason };
}

export function strongest(decisions) {
  return decisions.filter(Boolean).sort((a, b) => SEVERITY[b.permissionDecision] - SEVERITY[a.permissionDecision])[0] || null;
}

const slashes = (text) => String(text || '').replace(/\\/g, '/');
const unquote = (token) => token.replace(/^["']+|["']+$/g, '');
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const any = (patterns, text) => patterns.some((re) => re.test(text));

/** مقاطع الأمر بين && و || و ; و | — كل مقطع أمر مستقل بكلمته الأولى وأهدافه. */
function segments(command) {
  return slashes(command).split(/&&|\|\||[;|\n]/).map((part) => part.trim()).filter(Boolean);
}

/** رموز المقطع التي قد تكون مسارات، بلا علامات اقتباس. */
function pathTokens(segment) {
  return segment.split(/[\s()<>=,`]+/).map(unquote).filter(Boolean);
}

/** الكلمة الأولى الفعلية في المقطع (بعد sudo و VAR=…)، بلا مسار ولا ‎.exe، بأحرف صغيرة. */
function headWord(segment) {
  const words = segment.split(/\s+/).map(unquote);
  const index = words.findIndex((word) => !PREFIX_WORDS.test(word));
  const head = (words[index] || '').split('/').pop().replace(/\.exe$/i, '').toLowerCase();
  return { head, next: (words[index + 1] || '').toLowerCase() };
}

/**
 * صيغة المسار للمطابقة. على Windows تُسقَط النقاط والمسافات الختامية وتدفقات NTFS (name::$DATA)،
 * فالمسار settings.json. يكتب في settings.json نفسه؛ دون هذا التوحيد يفلت من كل حاجز يطابق الاسم.
 */
export function canonicalPath(path) {
  const text = slashes(path);
  if (process.platform !== 'win32') return text;
  const parts = text.split('/');
  return parts.map((part, index) => {
    const name = index === parts.length - 1 && index > 0 ? part.replace(/(?<=.):.*$/, '') : part;
    return /^\.+$/.test(name) ? name : name.replace(/[. ]+$/, '');
  }).join('/');
}

/** ‎$PWD/ و ‎$env:CLAUDE_PROJECT_DIR/ وأمثالهما تعني جذر المشروع: تُحذف حتى يُطابَق ما بعدها كمسار نسبي. */
const PROJECT_ROOT_PREFIX = /^(?:\$\{?pwd\}?|\$env:(?:CLAUDE_PROJECT_DIR|PWD)|\$\{?CLAUDE_PROJECT_DIR\}?|%cd%)\//i;

function isProtectedToken(token) {
  const rel = toProjectRelative(canonicalPath(token.replace(PROJECT_ROOT_PREFIX, '')));
  if (!rel) return false;
  const bare = rel.replace(/\/\*+$/, '').replace(/\/$/, '').toLowerCase();
  return any(PROTECTED_INSTRUCTION_PATHS, rel) || PROTECTED_DIRS.includes(bare);
}

const protectedTargets = (segment) => pathTokens(segment).filter(isProtectedToken);

/** هل يعدّل المقطع ملفات؟ insideProtected: سبقه cd إلى مجلد محمي، فأي هدف نسبي فيه محمي. */
function mutates(segment, targets, insideProtected) {
  const redirected = insideProtected
    ? />/.test(segment)
    : targets.some((token) => new RegExp(`>{1,2}\\s*["']?${escapeRegex(token)}`).test(segment));
  if (redirected || DOTNET_FILE_WRITE.test(segment)) return true;
  const { head, next } = headWord(segment);
  if (head === 'git') return MUTATING_GIT.test(next);
  if (head === 'sed' || head === 'perl') return /\s-[a-zA-Z]*i|--in-place/.test(segment);
  if (head === 'find') return /\s-delete\b|\s-exec\s+(?:rm|mv|shred|chmod)\b/.test(segment);
  if (SHELL_WRAPPERS.has(head) || SCRIPT_INTERPRETERS.has(head)) return INLINE_WRITE.test(segment);
  if (head === 'new-item' || head === 'ni') return !/-ItemType\s+Directory/i.test(segment);
  return MUTATING_COMMANDS.has(head);
}

function tamperAsk(targets) {
  const names = targets.length ? [...new Set(targets)].join('، ') : 'ملفات داخل مجلد محمي';
  return decide('ask', `🛡️ هذا الأمر يغيّر ملفات الحماية في القالب (${names}). وافق فقط إذا طلبتَ أنت هذا التغيير.`);
}

function tamperDecision(segment, insideProtected) {
  const targets = protectedTargets(segment);
  if ((!targets.length && !insideProtected) || !mutates(segment, targets, insideProtected)) return null;
  return tamperAsk(targets);
}

const TOO_COMPLEX = decide('ask', '🛡️ هذا الأمر يبني مساراته من متغيرات كثيرة أو طويلة، فلا يستطيع الحارس فحصه كاملاً. وافق فقط إذا كنت تعرف ما يفعله.');

const entersProtectedDir = (segment) => /^(?:cd|chdir|pushd|set-location|sl)$/.test(headWord(segment).head) && protectedTargets(segment).length > 0;

/** ls <ملفات محمية> | xargs rm: الهدف في مقطع والحذف في مقطع آخر، فيُفحص الأمر كله. */
function xargsDecision(command) {
  if (!/\bxargs\s+(?:-\S+\s+)*(?:rm|mv|shred|chmod|del)\b/.test(command)) return null;
  const targets = protectedTargets(slashes(command));
  return targets.length ? tamperAsk(targets) : null;
}

const isPublicKey = (path) => /\.pub$/i.test(path);
const isSecretStore = (path) => !isPublicKey(path) && any(SECRET_STORES, path);
const isProjectKeyFile = (path) => any(PROJECT_KEY_FILES, path);

function secretsDecision(segment) {
  const tokens = pathTokens(segment).map(canonicalPath);
  const stores = tokens.filter((token) => isSecretStore(token) || isProjectKeyFile(token));
  const reads = READ_OR_EXFIL_COMMAND.test(segment);
  if (stores.length) {
    const names = [...new Set(stores)].join('، ');
    return reads
      ? decide('deny', `🔒 حماية الأسرار: ${names} ملف مفاتيح سرية، فلا يقرؤه الوكيل ولا ينقله.`)
      : decide('ask', `🔒 هذا الأمر يمسّ ملف مفاتيح سرية (${names}). وافق فقط إذا طلبتَ أنت ذلك.`);
  }
  const keys = tokens.filter((token) => KEY_MATERIAL.test(token));
  if (keys.length && reads) {
    return decide('ask', `🔒 ${[...new Set(keys)].join('، ')} قد يكون مفتاحاً سرياً. وافق على عرضه فقط إذا كنت متأكداً أنه غير سري.`);
  }
  return null;
}

function downloadsThenRuns(command) {
  for (const match of command.matchAll(DOWNLOAD_TO_SCRIPT)) {
    const name = escapeRegex(slashes(match[1]).split('/').pop());
    const rest = command.slice(match.index + match[0].length);
    if (new RegExp(`${SCRIPT_RUNNER}${name}(?=$|[\\s"';|&)])`, 'i').test(rest)) return true;
  }
  return false;
}

function remoteExecDecision(command) {
  if (!any(REMOTE_EXEC, command) && !downloadsThenRuns(command)) return null;
  return decide('ask', '🌐 هذا الأمر ينزّل برنامجاً من الإنترنت ويشغّله فوراً. وافق فقط إذا طلبتَ أنت تثبيته.');
}

function keychainDecision(command) {
  if (!KEYCHAIN_READ.test(command)) return null;
  return decide('deny', '🔒 حماية الأسرار: هذا الأمر يقرأ كلمات مرور محفوظة في سلسلة مفاتيح الجهاز، فلا يشغّله الوكيل.');
}

function uploadDecision(command) {
  if (!any(UPLOAD, command)) return null;
  const hosts = [...command.matchAll(URL_HOST)].map((match) => match[1]);
  if (hosts.length && hosts.every((host) => LOCAL_HOST.test(host))) return null;
  const destination = hosts.length ? [...new Set(hosts)].join('، ') : 'خادم خارجي';
  return decide('ask', `📤 هذا الأمر يرسل ملفاً من جهازك إلى الإنترنت (${destination}). وافق فقط إذا طلبتَ أنت إرساله.`);
}

/** يفحص أمر طرفية. يعيد أشد قرار ({ permissionDecision, reason }) أو null إذا لم يُرصد شيء. */
export function checkCommandThreats(command) {
  // علامات التنصيص المهرَّبة (\" و \') كما يكتبها بعض النماذج تُعاد إلى أصلها، وإلا تحولت الشرطة المائلة إلى جزء من المسار
  const text = String(command || '').replace(/\\(?=["'])/g, '');
  if (!text.trim()) return null;
  const whole = [remoteExecDecision(text), uploadDecision(text), keychainDecision(text)];
  const variables = assignedValues(slashes(text));
  // توسيع المقاطع كلها بميزانية واحدة: متغيرات كثيرة الاستعمال تضخّم الأمر أضعافاً، فيُسأل عنه المستخدم بدل فحصه
  const expanded = [];
  let size = 0;
  for (const segment of variables ? segments(text) : []) {
    const value = expandVariables(segment, variables);
    size += value === null ? Infinity : value.length;
    if (size > 2 * MAX_COMMAND_CHARS) break;
    expanded.push(value);
  }
  if (!variables || size > 2 * MAX_COMMAND_CHARS) return strongest([TOO_COMPLEX, ...whole]);
  let insideProtected = false;
  const perSegment = expanded.flatMap((segment) => {
    const found = [tamperDecision(segment, insideProtected), secretsDecision(segment)];
    insideProtected = insideProtected || entersProtectedDir(segment);
    return found;
  });
  return strongest([...whole, xargsDecision(text), ...perSegment]);
}

function isHomeNpmrc(filePath) {
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return same(resolve(String(filePath)), join(homedir(), '.npmrc'));
}

/** يفحص هدف أداة ملفات (Read / Grep / Write / Edit ...) مقابل مخازن المفاتيح وملفات التوقيع. */
export function checkPathThreats(toolName, filePath) {
  if (!filePath) return null;
  const path = slashes(filePath);
  if (isSecretStore(path) || isHomeNpmrc(filePath)) {
    return decide('deny', `🔒 حماية الأسرار: ${path} ملف مفاتيح سرية، فلا يقرؤه الوكيل ولا يعدّله.`);
  }
  if (isProjectKeyFile(path)) {
    const firstWrite = toolName === 'Write' && !existsSync(resolve(projectDir(), String(filePath)));
    return firstWrite ? null : decide('deny', `🔒 حماية الأسرار: ${path} ملف توقيع فيه كلمات مرور، فلا يقرؤه الوكيل ولا يعدّله. املأه أنت بنفسك.`);
  }
  if (KEY_MATERIAL.test(path) && !isPublicKey(path) && !WRITE_TOOLS.has(toolName)) {
    return decide('ask', `🔒 ${path} قد يكون مفتاحاً سرياً. وافق على قراءته فقط إذا كنت متأكداً أنه غير سري.`);
  }
  return null;
}
