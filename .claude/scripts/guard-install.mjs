#!/usr/bin/env node
/**
 * حقيبة الحارس: يركّب حواجز القالب وحدها في مشروع قائم، أو يحدّثها، أو يزيلها.
 * التشغيل من مجلد القالب:
 *   node .claude/scripts/guard-install.mjs <مسار المشروع>            تركيب، أو تحديث إذا كانت مركّبة
 *   node .claude/scripts/guard-install.mjs <مسار المشروع> --remove   إزالة كل ما أضافته الحقيبة
 * يركّبها لـ Claude Code و OpenCode و Cursor معاً. لا يمس كود المشروع ولا CLAUDE.md ولا AGENTS.md، ويدمج إعداداته في
 * .claude/settings.json و .cursor/hooks.json و opencode.json دون حذف ما كتبه صاحب المشروع.
 * رموز الخروج: 0 نجاح، 1 خطأ (يُطبع سببه، ولا يتغير شيء إن كان الخطأ قبل الكتابة).
 */
import { resolve } from 'node:path';
import { CURSOR_HOOKS, CURSOR_IGNORE, CURSOR_RULES, OPENCODE_CONFIG, OPENCODE_PLUGIN } from './guard-kit/hosts.mjs';
import { CONFIG_FILE, KIT_DIR, KitError, RULES_FILE, install, remove } from './guard-kit/install.mjs';

const args = process.argv.slice(2);
const FLAGS = new Set(['--remove', '--help']);
const target = args.find((arg) => !arg.startsWith('--'));
const unknown = args.filter((arg) => arg.startsWith('--') && !FLAGS.has(arg));
const USAGE = [
  'الاستخدام: node .claude/scripts/guard-install.mjs <مسار مشروعك> [--remove]',
  '  بلا خيارات: يركّب حقيبة الحارس في المشروع، أو يحدّثها إذا كانت مركّبة.',
  '  --remove : يزيل الحقيبة وكل ما أضافته.',
].join('\n');

function checksLines(checks) {
  if (!checks.length) {
    return [
      '⚠️ لم أجد أوامر فحص أعرفها في هذا المشروع، فلن تُفحص التعديلات آلياً حتى تكتبها في',
      `   ${CONFIG_FILE}، مثلاً: "checks": [{ "step": "test", "run": "pytest -q" }]`,
    ];
  }
  return [
    'أوامر الفحص التي وجدتُها (يشغّلها الحارس قبل أن يُسمح للوكيل بإعلان النجاح):',
    ...checks.map((step) => `  • ${step.label}: ${step.cmd}`),
  ];
}

function printInstall(dir, result) {
  const heading = result.previousVersion
    ? `🛡️ حُدّثت حقيبة الحارس من v${result.previousVersion} إلى v${result.version} في: ${dir}`
    : `🛡️ رُكّبت حقيبة الحارس v${result.version} في: ${dir}`;
  const opencode = result.opencodeJsonc
    ? `${OPENCODE_PLUGIN} (لم ألمس opencode.jsonc؛ الإضافة نفسها تمنع قراءة ملفات الأسرار)`
    : `${OPENCODE_PLUGIN} و ${OPENCODE_CONFIG}`;
  const lines = [
    heading, '', 'ما أُضيف إلى المشروع:',
    `  • ${KIT_DIR}/ — الحواجز وأداة الفحص، للبرامج الثلاثة (لا تعدّل ما فيه؛ التحديث يستبدله)`,
    `  • ${CONFIG_FILE} — إعداداتك: الوضع وأوامر الفحص وسقف الحجم${result.configCreated ? '' : ' (موجود من قبل، لم يُمس)'}`,
    `  • لـ Claude Code: .claude/settings.json (دُمجت فيه الحواجز دون حذف شيء) و ${RULES_FILE}`,
    `  • لـ OpenCode: ${opencode}`,
    `  • لـ Cursor: ${CURSOR_HOOKS} و ${CURSOR_RULES} و ${CURSOR_IGNORE}`,
  ];
  if (result.gitignoreAdded) lines.push('  • .gitignore — سطر واحد: .claude/state/');
  lines.push('', ...checksLines(result.checks), '', 'الخطوة التالية: افتح المشروع في برنامجك (Claude Code أو OpenCode أو Cursor) وابدأ جلسة جديدة.');
  lines.push('في آخر كل رد عدّل فيه الوكيل كوداً يذكر لك نتيجة الفحص.');
  lines.push(result.ownStatusLine
    ? 'ℹ️ سطر الحالة الخاص بك بقي كما هو، فلن تظهر فيه شارة الحارس.'
    : 'وفي الطرفية يعرضها سطر الحالة أيضاً بجانب «🛡️ الحارس» (تطبيق سطح المكتب لا يعرض سطر الحالة).');
  lines.push('للتحديث بعد تحديث القالب: أعد الأمر نفسه. للإزالة: أضف --remove.');
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printRemoval(dir, result) {
  const lines = [`🧹 أُزيلت حقيبة الحارس من: ${dir}`, 'حُذفت الحواجز وتعليمات الوكيل، وأُعيدت .claude/settings.json إلى ما كانت عليه قبل الحقيبة.'];
  if (result.configKept) lines.push(`ℹ️ تركتُ ${CONFIG_FILE} لأن فيه إعداداتك؛ احذفه بنفسك إن لم تعد تحتاجه.`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
  if (!target || unknown.length || args.includes('--help')) {
    if (unknown.length) process.stderr.write(`❌ خيار غير معروف: ${unknown.join(' ')}\n`);
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = args.includes('--help') && !unknown.length ? 0 : 1;
    return;
  }
  const dir = resolve(target);
  try {
    if (args.includes('--remove')) printRemoval(dir, remove(dir));
    else printInstall(dir, install(dir));
  } catch (error) {
    if (!(error instanceof KitError)) throw error;
    process.stderr.write(`❌ ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
