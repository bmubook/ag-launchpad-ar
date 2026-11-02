/**
 * الملفات المعزولة: وحدة (مكوّن، خدمة، أداة) لا يستوردها أي ملف في التطبيق. «ملف لا يستورده شيء ليس مكتملاً»:
 * في مشاريع حقيقية أُعلن اكتمال ميزات كُتبت ملفاتها ولم تُربط بأي شاشة (docs/research-lessons-2026-11.md §أ-6).
 * بالتقريب، لـ JavaScript/TypeScript و Dart: يكفي أن يذكر ملف آخر اسمها في مسار ('./name' أو 'x/name.dart').
 * الاختبارات لا تُحسب مستورداً: ما يستورده الاختبار وحده لم يصل للمستخدم.
 * يستخدمه Hook التوقف (ملف عُدّل في هذه الجولة) وتقرير الصحة (المشروع كله).
 */
import { needsVerification, readText, walkFiles, walkWasTruncated } from './files.mjs';
import { isTestFile } from './shortcuts.mjs';

const MODULE = /\.(m?[jt]sx?|vue|svelte|dart)$/i;
const MODULE_DIR = /(^|\/)(components|services|lib|utils|helpers|hooks|features|stores?|api|repositories|providers|widgets|models|composables|screens)\//i;
// نقاط الدخول تستوردها الأداة لا الكود: صفحات Next.js و Expo Router ومسارات pages، و main و index، والأنواع والقصص
// ودوال Vercel في api/ بالجذر، ومسارات خادم Nuxt/Nitro: تربطها الأداة بمسارها لا باستيراد
const ENTRY = /(^|\/)(index|main|app|page|layout|route|loading|error|not-found|global-error|template|default|middleware|_layout|\+[\w-]+)\.[a-z]+$|\.d\.ts$|\.(stories|config)\.[a-z]+$|(^|\/)(app|pages)\/|^api\/|(^|\/)server\/(api|routes|middleware|utils|plugins)\//i;
// الاستيراد التلقائي (Nuxt، unplugin-auto-import، unplugin-vue-components) يربط هذه المجلدات دون سطر استيراد
const AUTO_IMPORTED = /(^|\/)(components|composables|utils)\//i;

function autoImports(root) {
  if (['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'].some((f) => readText(root, f) !== null)) return true;
  return /unplugin-(auto-import|vue-components)/.test(readText(root, 'package.json') || '');
}
const MAX_TEXT = 32 * 1024 * 1024;
// مقطع مسار بعد / أو علامة اقتباس: فئة واحدة بحد أعلى للطول، وبادئات قليلة لكل مقطع، فالمسح خطي مهما صُنع النص
// و </Card> وسم إغلاق في JSX لا مسار: لا يُحسب ذكراً لملف
const SEGMENT = /((?<!<)\/|['"])([\w$@+.-]{1,255})/g;
const MAX_PARTS = 8;
const MANY = Symbol('many');

export const isModuleFile = (rel) => MODULE.test(rel) && MODULE_DIR.test(rel) && !ENTRY.test(rel) && !isTestFile(rel) && !rel.startsWith('.claude/');

const nameOf = (rel) => rel.split('/').pop().replace(/\.[^.]+$/, '');

/**
 * الأسماء التي يذكرها نص في مسارات: بعد / كل بادئة عند نقطة ('/user.service.ts' ← user و user.service و user.service.ts)،
 * وبعد علامة اقتباس البادئات التي تليها نقطة فقط ('badge.dart' ← badge)، لا النص المقتبس كله.
 */
function mentionedNames(text, into) {
  for (const [, mark, segment] of text.matchAll(SEGMENT)) {
    const parts = segment.split('.', MAX_PARTS);
    const upTo = mark === '/' ? parts.length : parts.length - 1;
    for (let i = 1; i <= upTo; i += 1) into.add(parts.slice(0, i).join('.'));
  }
}

/**
 * من بين candidates: الوحدات التي لا يذكرها أي ملف آخر في التطبيق. كل ملف يُقرأ ويُمسح مرة واحدة.
 * isLate اختياري (Hook التوقف): عند انتهاء الوقت أو تجاوز حد الحجم يعيد { orphans: [], partial: true }،
 * فلا يُتهم ملف بالعزلة قبل قراءة كل ما قد يستورده.
 */
export function findOrphans(root, candidates, isLate = () => false) {
  let modules = candidates.filter(isModuleFile);
  if (modules.length && autoImports(root)) modules = modules.filter((rel) => !AUTO_IMPORTED.test(rel));
  if (!modules.length) return { orphans: [], partial: false };
  // الاسم ← أول ملف ذكره، أو MANY إذا ذكره أكثر من ملف؛ الوحدة معزولة إذا لم يذكرها أحد أو ذكرت نفسها فقط
  const mentionedBy = new Map();
  let size = 0;
  for (const rel of walkFiles(root)) {
    if (isLate()) return { orphans: [], partial: true };
    if (!needsVerification(rel) || isTestFile(rel) || rel.startsWith('.claude/')) continue;
    const text = readText(root, rel);
    if (text === null) continue;
    size += text.length;
    if (size > MAX_TEXT) return { orphans: [], partial: true };
    const names = new Set();
    mentionedNames(text, names);
    for (const name of names) mentionedBy.set(name, mentionedBy.has(name) ? MANY : rel);
  }
  // سرد انقطع عند سقفه (مستودع ضخم): ما لم يُقرأ قد يكون هو المستورد
  if (walkWasTruncated(root)) return { orphans: [], partial: true };
  const isOrphan = (rel) => {
    const by = mentionedBy.get(nameOf(rel));
    return by === undefined || by === rel;
  };
  return { orphans: modules.filter(isOrphan), partial: false };
}
