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
  DOWNLOAD_TO_SCRIPT, INLINE_WRITE, KEY_MATERIAL, LOCAL_HOST, MUTATING_COMMANDS, MUTATING_GIT, PROJECT_KEY_FILES,
  PROTECTED_DIRS, PROTECTED_INSTRUCTION_PATHS, READ_OR_EXFIL_COMMAND, REMOTE_EXEC, SCRIPT_INTERPRETERS, SCRIPT_RUNNER,
  SECRET_STORES, SHELL_WRAPPERS, UPLOAD, URL_HOST,
} from './patterns.mjs';

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

function isProtectedToken(token) {
  const rel = toProjectRelative(canonicalPath(token));
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
  if (redirected) return true;
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
  return decide('ask', `🛡️ هذا الأمر يعدّل أو يحذف ${names} وهو من ملفات الحوكمة/طبقة الإنفاذ (البند 6). `
    + 'تعديله يغيّر سلوك الوكيل أو يعطّل الحماية، ويحتاج موافقتك الصريحة. تعديل المهارات يكون بأداة التعديل لا بالطرفية.');
}

function tamperDecision(segment, insideProtected) {
  const targets = protectedTargets(segment);
  if ((!targets.length && !insideProtected) || !mutates(segment, targets, insideProtected)) return null;
  return tamperAsk(targets);
}

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
      ? decide('deny', `🔒 حماية الأسرار (البند 5): ${names} مخزن مفاتيح أو بيانات دخول (مفاتيح SSH، حسابات سحابية، رموز نشر، ملفات توقيع). لا يقرؤه الوكيل ولا ينقله.`)
      : decide('ask', `🔒 هذا الأمر يمسّ ${names} وهو مخزن مفاتيح أو بيانات دخول. وافق فقط إذا طلبتَ أنت هذه العملية وتعرف أثرها.`);
  }
  const keys = tokens.filter((token) => KEY_MATERIAL.test(token));
  if (keys.length && reads) {
    return decide('ask', `🔒 ${[...new Set(keys)].join('، ')} يبدو ملف مفتاح خاص، وهذا الأمر يعرض محتواه. وافق فقط إذا كان شهادة عامة غير سرية.`);
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
  return decide('ask', '🌐 تنزيل وتشغيل مباشر (البند 6): هذا الأمر يجلب سكربتاً من الإنترنت وينفّذه فوراً دون أن يراه أحد. '
    + 'وافق فقط إذا طلبتَ أنت تثبيت هذه الأداة ومن موقعها الرسمي.');
}

function uploadDecision(command) {
  if (!any(UPLOAD, command)) return null;
  const hosts = [...command.matchAll(URL_HOST)].map((match) => match[1]);
  if (hosts.length && hosts.every((host) => LOCAL_HOST.test(host))) return null;
  const destination = hosts.length ? [...new Set(hosts)].join('، ') : 'خادم خارجي';
  return decide('ask', `📤 رفع ملف إلى الخارج (البند 6): هذا الأمر يرسل ملفاً من جهازك إلى ${destination}. وافق فقط إذا طلبتَ أنت هذا الإرسال وتعرف الوجهة.`);
}

/** يفحص أمر طرفية. يعيد أشد قرار ({ permissionDecision, reason }) أو null إذا لم يُرصد شيء. */
export function checkCommandThreats(command) {
  const text = String(command || '');
  if (!text.trim()) return null;
  let insideProtected = false;
  const perSegment = segments(text).flatMap((segment) => {
    const found = [tamperDecision(segment, insideProtected), secretsDecision(segment)];
    insideProtected = insideProtected || entersProtectedDir(segment);
    return found;
  });
  return strongest([remoteExecDecision(text), uploadDecision(text), xargsDecision(text), ...perSegment]);
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
    return decide('deny', `🔒 حماية الأسرار (البند 5): ${path} مخزن مفاتيح أو بيانات دخول (مفاتيح SSH، حسابات سحابية، رموز نشر). لا يقرؤه الوكيل ولا يعدّله.`);
  }
  if (isProjectKeyFile(path)) {
    const firstWrite = toolName === 'Write' && !existsSync(resolve(projectDir(), String(filePath)));
    return firstWrite ? null : decide('deny', `🔒 حماية الأسرار (البند 5): ${path} ملف توقيع يحوي مفاتيح أو كلمات مرور. لا يقرؤه الوكيل ولا يعدّله؛ يملؤه المستخدم بنفسه.`);
  }
  if (KEY_MATERIAL.test(path) && !isPublicKey(path) && !WRITE_TOOLS.has(toolName)) {
    return decide('ask', `🔒 ${path} يبدو ملف مفتاح خاص. وافق على قراءته فقط إذا كان شهادة عامة غير سرية.`);
  }
  return null;
}
