#!/usr/bin/env node
/**
 * Hook الحارس الأمني (PreToolUse) — منطقه في lib/secret-guard.mjs.
 * هذا الملف يحمّله بلا أي استيراد ثابت، ليفشل مغلقاً: لو انكسر ملف من ملفات الحارس (خطأ صياغة، ملف ناقص)
 * أو رمى استثناءً، لا يمرّ الإجراء دون فحص بصمت كما تفعل بقية الـ Hooks، بل يُسأل المستخدم عنه
 * (ويُمنع في Cursor لأنه بلا نافذة موافقة). أما تجاوز مهلة الـ Hook فتقرره الأداة المضيفة لا هذا الملف.
 */
const FAILURE = '🛡️ تعطّل الحارس الأمني أثناء فحص هذا الإجراء، فلم يُفحص. وافق فقط إذا كنت تعرف ما يفعله، '
  + 'وأخبر المستخدم أن الحارس يحتاج إصلاحاً: شغّل node .claude/scripts/verify.mjs لمعرفة الملف المعطوب.';

function failClosed() {
  const output = process.argv.includes('--host=cursor')
    ? { permission: 'deny', user_message: FAILURE, agent_message: FAILURE }
    : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: FAILURE } };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// استثناء خارج سلسلة await (داخل مستمع قراءة المدخلات مثلاً) يُنهي العملية برمز 1 بلا مخرج، فتسمح الأداة المضيفة
process.on('uncaughtException', failClosed);
process.on('unhandledRejection', failClosed);

try {
  const { runGuard } = await import('./lib/secret-guard.mjs');
  await runGuard();
} catch {
  failClosed();
}
