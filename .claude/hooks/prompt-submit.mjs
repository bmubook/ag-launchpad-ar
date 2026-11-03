#!/usr/bin/env node
/**
 * Hook إرسال الرسالة (UserPromptSubmit):
 * 1) يبدأ "جولة" جديدة بتصفير قائمة الملفات المعدّلة (يستخدمها Hook التوثيق عند التوقف).
 * 2) يعدّ رسائل المستخدم، وكل 15 رسالة يحقن نقطة تفتيش إلزامية (master_rules.md §12-ب).
 * 3) في أداة لا توصل سياق بداية الجلسة للنموذج (Cursor): يحقن ملخص الحالة مع أول رسالة في المحادثة.
 * 4) يحقن تذكير العربية مع كل رسالة (master_rules.md §2)، لأن النموذج يعود للإنجليزية بعد رسالتين أو ثلاث
 *    خصوصاً في الجمل القصيرة بين الخطوات ووصف أوامر الطرفية.
 */
import {
  addContext, loadSession, projectDir, pruneOldSessions, readProjectState, readStdinJson, runHook, saveSession,
} from './lib/common.mjs';
import { fingerprint } from './lib/fingerprint.mjs';
import { hostTraits } from './lib/host.mjs';
import { GUARD_KIT } from './lib/kit.mjs';
import { PROTECTED_INSTRUCTION_PATHS } from './lib/patterns.mjs';
import { buildSessionContext } from './lib/summary.mjs';

const CHECKPOINT_EVERY = 15;
const FS_CLOCK_SLACK_MS = 15;
const ARABIC_REMINDER = '🔤 إلزامي في هذا الرد كله (master_rules.md §2): كل ما يظهر للمستخدم يُكتب بالعربية — الرد، '
  + 'والجمل القصيرة بين الخطوات أثناء العمل، ووصف أوامر الطرفية، وبنود قائمة المهام، والملخص الختامي، والأسئلة وخياراتها. '
  + 'الإنجليزية فقط داخل الكود والأوامر والمسارات وأسماء التقنيات ورسائل Git.';

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
  // turnStartedAt: يكشف به Hook التوقف ما عُدّل في هذه الجولة بأوامر الطرفية. ساعة نظام الملفات في Linux والماك خشنة
  // تتأخر بضعة أجزاء من الثانية عن Date.now()، فملف عُدّل فور بدء الجولة قد يحمل وقتاً أقدم منها؛ لذلك الهامش.
  // governance: بصمة محتوى ملفات الحوكمة، يقارن بها Hook التوقف ما تغيّر منها بأمر طرفية
  saveSession(input.session_id, {
    ...session, prompts, edited: [], shortcuts: {}, turnStartedAt: Date.now() - FS_CLOCK_SLACK_MS,
    governance: fingerprint(projectDir(), PROTECTED_INSTRUCTION_PATHS),
  });
  const context = [];
  if (!hostTraits(input.host).sessionContext && prompts === 1) {
    pruneOldSessions();
    context.push(buildSessionContext('startup', input.host));
  }
  // نقطة التفتيش تعيد قراءة الملفات الحاكمة، والحقيبة بلا ملفات حاكمة
  if (prompts % CHECKPOINT_EVERY === 0 && !GUARD_KIT) context.push(checkpointContext(prompts));
  // الحقيبة تحمل الحواجز وحدها بلا قواعد التواصل
  if (!GUARD_KIT) context.push(ARABIC_REMINDER);
  if (context.length) addContext('UserPromptSubmit', context.join('\n\n'));
});
