#!/usr/bin/env node
/**
 * Hook بداية الجلسة (SessionStart) — بروتوكول بداية الجلسة الآلي (master_rules.md §12-أ).
 * يحقن ملخص حالة المشروع: المراسي من project_map.md، آخر 5 تغييرات، الأخطاء النشطة، آخر 5 قرارات.
 * عند source = "compact" يأمر بنقطة تفتيش فورية (§12-ب) لأن السياق ضُغط للتو.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  GOVERNANCE_FILES, addContext, projectDir, pruneOldSessions, readProjectFile,
  readProjectState, readStdinJson, runHook, tableRows, truncate,
} from './lib/common.mjs';
import { gateStatus, loadQuality } from './lib/quality.mjs';

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
  const { verify, pending } = loadQuality();
  const run = 'node .claude/scripts/verify.mjs';
  if (gate === 'green') return [`• 🧪 بوابة الإثبات: آخر فحص ناجح ✅${Number.isFinite(verify.tests) ? ` (${verify.tests} اختباراً)` : ''}. بعد أي تعديل كودي شغّل ${run} قبل إنهاء الرد.`];
  if (gate === 'red') return [`• 🔴 بوابة الإثبات: آخر فحص فاشل عند «${verify.failedLabel || verify.failed}». الاستقرار يسبق الميزات (البند 0): أبلغ المستخدم في ردك الأول وأصلحه عبر /fix قبل أي ميزة جديدة.`];
  if (gate === 'stale') return [`• 🟠 بوابة الإثبات: ${pending.files.length} ملفاً معدّلاً لم يُفحص منذ آخر فحص ناجح (${truncate(pending.files.join('، '), 160)}). شغّل ${run} قبل البناء فوقها.`];
  if (gate === 'partial') return [`• 🟠 بوابة الإثبات: آخر فحص سريع دون البناء. شغّل ${run} (الفحص الكامل) قبل أي ميزة جديدة.`];
  if (gate === 'never') return [`• 🧪 بوابة الإثبات: لم يُشغَّل فحص المشروع بعد. شغّل ${run} قبل أول تعديل لتعرف نقطة البداية.`];
  return [];
}

function section(title, items, emptyText) {
  return [`• ${title}:`, ...(items.length ? items : [`  - ${emptyText}`])];
}

function buildContext(source) {
  const state = readProjectState();
  const missing = GOVERNANCE_FILES.filter((file) => !existsSync(join(projectDir(), file)));
  const lines = ['🧭 حالة المشروع — Hook بداية الجلسة (AG Launchpad AR)'];

  if (source === 'compact') {
    lines.push('🔄 تم ضغط السياق للتو: نفّذ نقطة تفتيش فورية (master_rules.md §12-ب) في ردك التالي بعد اسم النداء.');
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
    lines.push(...gateLines(state.mode));
  }

  // قبل الإقلاع تحوي السجلات تاريخ تطوير القالب نفسه لا تاريخ مشروع المستخدم — فلا تُعرض (يعرض /kickoff تنظيفها).
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

runHook(async () => {
  const input = await readStdinJson();
  pruneOldSessions();
  addContext('SessionStart', buildContext(input.source || 'startup'));
});
