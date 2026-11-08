/**
 * أسرار بلا شكل ثابت داخل أوامر الطرفية (البند 5): كلمة مرور في رابط قاعدة بيانات، أو رمز Bearer، أو قيمة سرية في متغير.
 * خطرها أن المستخدم إذا وافق بخيار «Yes, and don't ask again» حُفظ الأمر بحروفه، ومعه السر، في .claude/settings.local.json،
 * وهو ملف وُجد بأسراره في آلاف المستودعات العامة (Apiiro، 2026-11). لذلك يُسأل عنها، ويُمنع رفع هذا الملف إلى Git بالقوة.
 * المفاتيح المعروفة الشكل يمنعها scanCommandSecrets في secret-guard.mjs قبل هذا الملف.
 * كل نمط هنا خطي الزمن: الأجزاء المتغيرة بحد أعلى ولا تتداخل (tests/redos.test.mjs).
 */
import { PLACEHOLDER_VALUE, SECRET_MEDIUM } from './patterns.mjs';
import { decide } from './threats.mjs';

/** كلمات مرور التطوير المحلي الافتراضية: ليست سراً، ووجودها في الأوامر شائع. */
const LOCAL_DEFAULT = /^(?:postgres|password|root|admin|test|secret|example)$/i;
const realValue = (value) => Boolean(value) && !PLACEHOLDER_VALUE.test(value) && !LOCAL_DEFAULT.test(value);
const byName = (name) => SECRET_MEDIUM.find((pattern) => pattern.name === name);

const COMMAND_SECRETS = [
  { ...byName('database URL with password'), label: 'كلمة مرور داخل رابط قاعدة بيانات' },
  { ...byName('JWT / service key'), label: 'رمز دخول (JWT)' },
  { label: 'رمز Bearer', re: /\bBearer\s{1,20}([A-Za-z0-9._~+/-]{20,1024})/gi, accept: (m) => realValue(m[1]) },
  {
    label: 'كلمة مرور بعد -p في أمر MySQL',
    re: /\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n;|&]{0,300}?\s-p([^\s'"$][^\s'"]{3,255})/gi,
    accept: (m) => realValue(m[1]),
  },
  {
    label: 'كلمة مرور أو رمز في خيار الأمر',
    re: /--(?:password|passwd|token|api-key|apikey|secret|access-token|auth-token)(?:=|\s{1,20})["']?([^\s"'$][^\s"']{5,255})/gi,
    accept: (m) => realValue(m[1]) && !/^(?:id|src|env)=/i.test(m[1]),
  },
  {
    label: 'قيمة سرية في متغير',
    re: /(?<![\w$])(?:\$env:)?(?:[A-Za-z_][A-Za-z0-9_]{0,60}?)?(?:token|secret|password|passwd|api_?key|access_?key|private_?key)[A-Za-z0-9_]{0,30}\s{0,5}=\s{0,5}["']?([^\s"'$][^\s"';&|]{7,255})/gi,
    accept: (m) => realValue(m[1]),
  },
];

const ASK_TEXT = (label) => `🔒 حماية الأسرار (البند 5): هذا الأمر يحتوي على ما يبدو ${label}. إن وافقت فاختر «Yes» وحده، لا «Yes, and don't ask again»: `
  + 'الخيار الثاني يحفظ الأمر بحروفه، ومعه السر، نصاً مكشوفاً في .claude/settings.local.json. الأفضل أن يقرأ الأمر السر من .env أو من متغير بيئة ($NAME) بدل كتابته فيه.';

/** إضافة بالقوة (-f / --force) لملف الإعدادات المحلية أو لمجلد .claude كله أو للمشروع كله: تتخطى .gitignore فترفع الأسرار المحفوظة. */
// git في موضع أمر فقط (أول السطر أو بعد ; & | أو قوس)، لا كلمة داخل نص: رسالة إيداع أو ملاحظة تذكر «git add -f» لا تُرفض
const FORCE_ADD = /(?:^|[;&|(\n])\s{0,20}git\s{1,20}add\b([^\n;|&]{0,500})/gi;
const FORCE_FLAG = /(?:^|\s)(?:-[A-Za-z]*f[A-Za-z]*|--force)(?=\s|$)/;
const DANGEROUS_TARGET = /(?:^|\s)["']?(?:\.claude\/settings\.local\.json|\.claude\/?|\.\/?|\*|-A|--all)["']?(?=\s|$)|settings\.local\.json/;

function checkForceAdd(command) {
  for (const match of command.matchAll(FORCE_ADD)) {
    const args = match[1] || '';
    if (FORCE_FLAG.test(args) && DANGEROUS_TARGET.test(args)) {
      return decide('deny', '🔒 حماية الأسرار (البند 5): هذا الأمر يضيف إلى Git بالقوة ملفات يستثنيها .gitignore، ومنها .claude/settings.local.json الذي قد يحفظ أوامر فيها أسرار، وملفات .env. أضف الملفات المطلوبة بأسمائها دون -f.');
    }
  }
  return null;
}

/** أشد قرار لأسرار الأمر التي لا يعرف شكلها SECRET_HIGH، أو null. */
export function scanSavedCommandSecrets(command) {
  const forced = checkForceAdd(command);
  if (forced) return forced;
  for (const pattern of COMMAND_SECRETS) {
    pattern.re.lastIndex = 0;
    const matches = pattern.re.global ? [...command.matchAll(pattern.re)] : [command.match(pattern.re)].filter(Boolean);
    if (matches.some((m) => !pattern.accept || pattern.accept(m))) return decide('ask', ASK_TEXT(pattern.label));
  }
  return null;
}
