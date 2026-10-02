#!/usr/bin/env node
/**
 * Hook إرسال الرسالة (UserPromptSubmit):
 * 1) يبدأ "جولة" جديدة بتصفير قائمة الملفات المعدّلة (يستخدمها Hook التوثيق عند التوقف).
 * 2) يعدّ رسائل المستخدم، وكل 15 رسالة يحقن نقطة تفتيش إلزامية (master_rules.md §12-ب).
 */
import {
  addContext, loadSession, readProjectState, readStdinJson, runHook, saveSession,
} from './lib/common.mjs';

const CHECKPOINT_EVERY = 15;

function checkpointContext(count) {
  const state = readProjectState();
  return [
    `🔄 نقطة تفتيش إلزامية (رسالة المستخدم رقم ${count}) — master_rules.md §12-ب:`,
    '1. أعد قراءة master_rules.md من القرص، وراجع المرحلة النشطة في project_map.md.',
    `2. اكتب في ردك بعد اسم النداء: 🔄 نقطة تفتيش: المرحلة [${state.phase || '؟'}]، الوضع [${state.mode}]، آخر تعديل [وصف مختصر].`,
    '3. إذا وجدت السياق غامضاً أو متعارضاً فأوقف العمل واكتب: [تنبيه: السياق أصبح غامضاً. أحتاج إعادة قراءة الملفات الأساسية قبل المتابعة]',
  ].join('\n');
}

runHook(async () => {
  const input = await readStdinJson();
  const session = loadSession(input.session_id);
  const prompts = session.prompts + 1;
  // turnStartedAt: يكشف به Hook التوقف ما عُدّل في هذه الجولة بأوامر الطرفية
  saveSession(input.session_id, { ...session, prompts, edited: [], shortcuts: {}, turnStartedAt: Date.now() });
  if (prompts % CHECKPOINT_EVERY === 0) addContext('UserPromptSubmit', checkpointContext(prompts));
});
