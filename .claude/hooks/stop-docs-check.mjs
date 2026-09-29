#!/usr/bin/env node
/**
 * Hook التوقف (Stop) — إلزامية التوثيق بعد كل تعديل (master_rules.md §2):
 * إذا عُدّلت ملفات كود في هذه الجولة ولم يُحدَّث changelog.md، يمنع إنهاء الرد مرة واحدة
 * ويطلب من الوكيل تنفيذ إجراء التوثيق وإضافة الختم. stop_hook_active يمنع الحلقات اللانهائية.
 */
import { emit, isCodeFile, loadSession, readStdinJson, runHook, truncate } from './lib/common.mjs';

runHook(async () => {
  const input = await readStdinJson();
  if (input.stop_hook_active) return;

  const { edited } = loadSession(input.session_id);
  const codeFiles = edited.filter(isCodeFile);
  if (!codeFiles.length || edited.includes('changelog.md')) return;

  const files = truncate(codeFiles.join('، '), 300);
  emit({
    decision: 'block',
    reason: `📋 التوثيق الإلزامي (master_rules.md §2): عدّلت ملفات كود في هذه الجولة (${files}) دون تحديث changelog.md. `
      + 'نفّذ إجراء التوثيق الآن (مهارة /document): سجّل التعديل بصيغة Conventional Commits، وحدّث project_map.md و bugs_log.md و decisions_log.md عند الحاجة، '
      + 'ثم أنهِ ردك بختم التوثيق. استثناء وحيد: إذا كان التعديل لم يكتمل بعد (عمل جارٍ لم يعبر الفحص) أو أُلغي بالكامل، '
      + 'فلا تضف مدخلاً ناقصاً — اذكر ذلك صراحةً في الختم: ⬜ changelog (قيد التنفيذ — يُوثَّق عند الاكتمال).',
  });
});
