/**
 * ملخص حالة المشروع الذي يُحقن في بداية الجلسة (master_rules.md §12-أ):
 * المراسي من project_map.md، آخر 5 تغييرات، الأخطاء النشطة، آخر 5 قرارات، وحالة بوابة الإثبات.
 * يستخدمه session-start.mjs في Claude Code، و prompt-submit.mjs مع أول رسالة في الأدوات التي لا توصل سياق بداية الجلسة.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  GOVERNANCE_FILES, projectDir, readProjectFile, readProjectState, tableRows, truncate,
} from './common.mjs';
import { hostTraits } from './host.mjs';
import { gateStatus, loadQuality, unverifiedFiles, verifyCommand } from './quality.mjs';

const RECENT_LIMIT = 5;

function recentChanges() {
  const rows = tableRows(readProjectFile('changelog.md'), /جدول التغييرات/);
  return rows.slice(-RECENT_LIMIT).map((c) => `  - ${c[0]} | ${c[1]} | ${truncate(c[5] || c[2], 140)}`);
}

function activeBugs() {
  const rows = tableRows(readProjectFile('bugs_log.md'), /ملخص الأخطاء النشطة/);
  return rows
    .filter((c) => !(c[c.length - 1] || '').includes('✅'))
    .map((c) => `  - ${c[2] || ''} ${truncate(c[4], 120)} — ${c[3] || ''} (${c[c.length - 1] || ''})`);
}

function recentDecisions() {
  const rows = tableRows(readProjectFile('decisions_log.md'), /جدول القرارات/);
  return rows.slice(-RECENT_LIMIT).map((c) => `  - ${c[1]} | ${truncate(c[2], 100)} | ${c[3]}`);
}

/** أسطر الإرشاد للمبتدئ: مستوى الخبرة، وضع التعلّم، اقتراحات التطوير، أفكار Backlog المفتوحة. */
function guidanceLines(state) {
  const lines = [];
  if (state.experience) lines.push(`• مستوى خبرة المستخدم: ${state.experience}`);
  if (/مبتدئ|أساسيات/.test(state.experience || '')) {
    lines.push('• ✂️ المستخدم غير مبرمج: اجعل ردودك قصيرة وبسيطة — الخلاصة أولاً، بلا مصطلح تقني غير مشروح، وخياران أو ثلاثة كحد أقصى (master_rules.md §2).');
  }
  if (state.learning) {
    lines.push('• 🎓 وضع التعلّم مفعّل: بعد كل قرار أو تعديل مهم أضف كتلة «🎓 تعلّم:» (سطران أو ثلاثة بلغة بسيطة)، واشرح أي مصطلح تقني عند أول ظهور، وأضف الجديد إلى docs/glossary.md.');
  }
  if (state.suggestions !== false) {
    lines.push('• 💡 اقتراحات التطوير مفعّلة: بعد إكمال أي مهمة وتوثيقها نفّذ «بروتوكول الاقتراحات» من .claude/skills/next/SKILL.md.');
  }
  if (state.backlogOpen) lines.push(`• أفكار مؤجلة مفتوحة في Backlog (project_map.md §12): ${state.backlogOpen}`);
  return lines;
}

/** حالة بوابة الإثبات عبر الجلسات: ما فُحص وما لم يُفحص منذ آخر جلسة. */
function gateLines(mode) {
  const gate = gateStatus(mode);
  const quality = loadQuality();
  const { verify } = quality;
  const run = verifyCommand(mode);
  const open = Object.keys(quality.shortcuts);
  const shortcutsLine = open.length ? [`• 🚩 اختصارات مفتوحة (البند 11) في ${open.length} ملفاً: ${truncate(open.join('، '), 160)}. أزلها أو صرّح بها للمستخدم قبل البناء فوقها.`] : [];
  return [...gateLine(gate, verify, quality, run, mode), ...shortcutsLine];
}

function gateLine(gate, verify, quality, run, mode) {
  if (gate === 'green') return [`• 🧪 بوابة الإثبات: آخر فحص ناجح ✅${Number.isFinite(verify.tests) ? ` (${verify.tests} اختباراً)` : ''}. بعد أي تعديل كودي شغّل ${run} قبل إنهاء الرد.`];
  if (gate === 'red') return [`• 🔴 بوابة الإثبات: آخر فحص فاشل عند «${verify.failedLabel || verify.failed}». الاستقرار يسبق الميزات (البند 0): أبلغ المستخدم في ردك الأول وأصلحه عبر /fix قبل أي ميزة جديدة.`];
  if (gate === 'stale') {
    const files = unverifiedFiles(undefined, quality);
    return [`• 🟠 بوابة الإثبات: ${files.length} ملفاً معدّلاً لم يُفحص منذ آخر فحص ناجح (${truncate(files.join('، '), 160)}). شغّل ${run} قبل البناء فوقها.`];
  }
  if (gate === 'partial') return [`• 🟠 بوابة الإثبات: آخر فحص سريع دون البناء. شغّل ${verifyCommand(mode)} (الفحص الكامل) قبل أي ميزة جديدة.`];
  if (gate === 'never') return [`• 🧪 بوابة الإثبات: لم يُشغَّل فحص المشروع بعد. شغّل ${run} قبل أول تعديل لتعرف نقطة البداية.`];
  return [];
}

const BLANK_CELL = /^[-—–\s]*$/;
const flowName = (cells) => `«${truncate(cells[1], 40)}»`;
/** جمل العقد هي الخانات بين اسم التدفق والأعمدة الثلاثة الأخيرة (المرحلة، الاختبار، الحالة)؛ خانة فارغة = جملة لم تُكتب. */
const contractIncomplete = (cells) => cells.slice(2, -3).some((cell) => BLANK_CELL.test(cell));

/** فهرس التدفقات (project_map.md §13): تدفق واحد في كل مرة بعقد مكتوب، والمقفل لا يُفتح إلا بفشل اختباره أو بطلب المستخدم. */
function flowLines() {
  const rows = tableRows(readProjectFile('project_map.md'), /فهرس التدفقات/);
  if (!rows.length) return [];
  const withStatus = (mark) => rows.filter((cells) => (cells[cells.length - 1] || '').includes(mark));
  const [locked, open, broken, waiting] = ['🔒', '🟡', '🔴', '⬜'].map(withStatus);
  const parts = [`🔒 ${locked.length} مقفل`];
  if (open.length) parts.push(`🟡 قيد العمل: ${open.map(flowName).join('، ')}`);
  if (broken.length) parts.push(`🔴 مكسور: ${broken.map(flowName).join('، ')}`);
  parts.push(`⬜ ${waiting.length} لم يبدأ`);
  const unwritten = open.find(contractIncomplete);
  let advice = 'ابدأ التدفق التالي عبر /next.';
  if (broken.length) advice = `أصلح ${flowName(broken[0])} عبر /fix قبل أي تدفق آخر.`;
  else if (unwritten) advice = `عقد ${flowName(unwritten)} ناقص: اكتب جمله الأربع في صفه قبل أي كود، واسأل المستخدم عن الجملة التي لا تعرف جوابها.`;
  else if (open.length) advice = `أكمل ${flowName(open[0])} قبل فتح تدفق آخر.`;
  const lock = locked.length ? ' لا تعدّل تدفقاً مقفلاً إلا إذا فشل اختباره أو طلب المستخدم ذلك.' : '';
  return [`• 🧩 التدفقات (project_map.md §13): ${parts.join(' | ')}. ${advice}${lock}`];
}

function section(title, items, emptyText) {
  return [`• ${title}:`, ...(items.length ? items : [`  - ${emptyText}`])];
}

/**
 * source = سبب بدء الجلسة ("compact" يأمر بنقطة تفتيش فورية §12-ب لأن السياق ضُغط للتو).
 * host = اسم الأداة لغير Claude Code: إن كانت لا تحمّل ملفات القواعد تلقائياً (Cursor) يُؤمر الوكيل بقراءتها.
 */
export function buildSessionContext(source, host) {
  const state = readProjectState();
  const missing = GOVERNANCE_FILES.filter((file) => !existsSync(join(projectDir(), file)));
  const lines = ['🧭 حالة المشروع — Hook بداية الجلسة (AG Launchpad AR)'];

  if (source === 'compact') {
    lines.push('🔄 تم ضغط السياق للتو: نفّذ نقطة تفتيش فورية (master_rules.md §12-ب) في ردك التالي بعد اسم النداء.');
  }
  if (!hostTraits(host).rulesLoaded) {
    lines.push('📚 هذه البيئة لا تستورد ملفات القواعد تلقائياً: اقرأ الآن master_rules.md و rules_security.md و rules_code_quality.md و rules_workflow.md كاملةً قبل أي عمل، و rules_ui.md قبل أي عمل على الواجهات.');
  }
  if (!state.kickedOff) {
    lines.push('⚠️ المشروع لم يُقلع بعد (اسم المشروع فارغ في project_map.md).');
    lines.push('   رحّب بالمستخدم بإيجاز واسأله (AskUserQuestion) كيف يبدأ: «افتح لي مولّد الإقلاع» (شغّل node .claude/scripts/open-setup.mjs ثم اطلب منه تعبئة النموذج ولصق النص المولَّد هنا)،');
    lines.push('   أو «أجب عن الأسئلة هنا في المحادثة» (نفّذ /kickoff دون بيانات فتُطرح الأسئلة نفسها داخل الشات).');
  } else {
    lines.push(`• المشروع: ${state.projectName} | الطبيعة: ${state.projectType || 'غير محددة'}`);
    lines.push(`• اسم النداء: ${state.callSign ? `«${state.callSign}» — افتتح به كل رد` : 'غير محدد (تخطَّ البند)'}`);
    lines.push(`• وضع التشغيل: ${state.mode} | المرحلة النشطة: ${state.phase || 'غير محددة'}`);
    lines.push(...guidanceLines(state));
    lines.push(...flowLines());
    lines.push(...gateLines(state.mode));
  }

  // قبل الإقلاع لا تاريخ لمشروع المستخدم بعد (تاريخ القالب في docs/template-changelog.md) — فلا تُعرض السجلات.
  if (state.kickedOff) {
    lines.push(...section('آخر التغييرات (changelog.md)', recentChanges(), 'لا توجد مدخلات بعد'));
    lines.push(...section('الأخطاء النشطة (bugs_log.md)', activeBugs(), 'لا أخطاء نشطة ✅'));
    lines.push(...section('آخر القرارات (decisions_log.md)', recentDecisions(), 'لا قرارات مسجلة بعد'));
  }

  if (missing.length) {
    lines.push(`⚠️ ملفات حاكمة مفقودة: ${missing.join('، ')} — نبّه المستخدم قبل أي عمل.`);
  }
  lines.push('• تذكير: الإنفاذ الآلي مفعّل (حماية .env، أسقف الملفات، كاشف الاختصارات، بوابة الإثبات، التوثيق الإلزامي). بعد كل تعديل كودي: افحص ثم وثّق عبر /document.');
  return lines.join('\n');
}
