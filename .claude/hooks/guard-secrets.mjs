#!/usr/bin/env node
/**
 * Hook الحارس الأمني (PreToolUse) — البندان 5 و 6 في rules_security.md:
 * - يمنع قراءة/تعديل ملفات البيئة الحقيقية (.env) ويمنع الكتابة فوق .env موجود.
 * - يمنع كتابة مفاتيح سرية مؤكدة داخل الملفات، ويسأل المستخدم عند الاشتباه.
 * - يمنع أوامر الطرفية التي تقرأ .env، ويسأل عن أي إشارة أخرى إليه.
 * - يسأل المستخدم قبل أي كتابة في ملفات التعليمات/الحوكمة، مع تنبيه حقن نصي إن وُجد.
 * - يوقف ما يحاوله وكيل مخدوع (lib/threats.mjs): تنزيل سكربت وتشغيله، تعديل طبقة الحماية بأمر طرفية،
 *   قراءة مخازن المفاتيح وبيانات الدخول، ورفع ملفات إلى خادم خارجي.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  emit, isRealEnvFile, isServiceAccountFile, projectDir, readStdinJson, runHook, toProjectRelative,
} from './lib/common.mjs';
import { hostTraits } from './lib/host.mjs';
import {
  ENFORCEMENT_PATHS, ENV_GLOB, ENV_REFERENCE, INJECTION, INJECTION_SCAN_EXEMPT, PROTECTED_INSTRUCTION_PATHS, READ_OR_EXFIL_COMMAND,
  SAFE_ENV_COMMANDS, SECRET_HIGH, SECRET_MEDIUM, SERVICE_ACCOUNT_REFERENCE,
} from './lib/patterns.mjs';
import { canonicalPath, checkCommandThreats, checkPathThreats, decide, strongest } from './lib/threats.mjs';

const ENV_ADVICE = 'أضف المفاتيح الجديدة بقيم فارغة إلى .env.example، واطلب من المستخدم نسخها إلى .env وتعبئتها بنفسه.';
const FIREBASE_HINT = 'إن كانت إعدادات Firebase للعميل فهي معرّفات عامة لكنها تبقى خارج الكود: اقرأها من متغيرات NEXT_PUBLIC_FIREBASE_* أو EXPO_PUBLIC_FIREBASE_*، وفي Flutter يولّدها الأمر flutterfire configure.';
/** ملفات إعداد Firebase للعميل التي تولّدها أدوات Firebase الرسمية — قيم apiKey فيها عامة بطبيعتها. */
const FIREBASE_CLIENT_CONFIG_FILES = /(^|\/)(firebase_options\.dart|google-services\.json|GoogleService-Info\.plist)$/;
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Delete']);

/** النصوص التي ستُكتب فعلاً حسب نوع الأداة. */
function writtenText(toolName, input) {
  if (toolName === 'Write') return input.content || '';
  if (toolName === 'Edit') return input.new_string || '';
  if (toolName === 'MultiEdit') return (input.edits || []).map((e) => e.new_string || '').join('\n');
  if (toolName === 'NotebookEdit') return input.new_source || '';
  return '';
}

function scanSecrets(text, relPath) {
  const isFirebaseConfig = FIREBASE_CLIENT_CONFIG_FILES.test(relPath);
  const high = SECRET_HIGH.find((p) => p.re.test(text) && !(isFirebaseConfig && p.publicInFirebaseConfig));
  if (high) {
    const hint = high.publicInFirebaseConfig ? ` ${FIREBASE_HINT}` : '';
    return decide('deny', `🔒 حماية الأسرار (البند 5 — rules_security.md): المحتوى المراد كتابته في ${relPath} يحتوي على ما يبدو ${high.name}. يُحظر وضع المفاتيح داخل الملفات؛ استدعِها من متغيرات البيئة. ${ENV_ADVICE}${hint}`);
  }
  for (const pattern of isFirebaseConfig ? [] : SECRET_MEDIUM) {
    pattern.re.lastIndex = 0;
    const matches = pattern.re.global ? [...text.matchAll(pattern.re)] : [text.match(pattern.re)].filter(Boolean);
    if (matches.some((m) => !pattern.accept || pattern.accept(m))) {
      return decide('ask', `🔒 اشتباه سر مكتوب في الكود (${pattern.name}) داخل ${relPath}. البند 5 يمنع المفاتيح في الكود — وافق فقط إذا كانت القيمة عامة وغير سرية.`);
    }
  }
  return null;
}

function checkInstructionFile(text, relPath) {
  if (!PROTECTED_INSTRUCTION_PATHS.some((re) => re.test(relPath))) return null;
  const exempt = INJECTION_SCAN_EXEMPT.some((re) => re.test(relPath));
  const injected = !exempt && INJECTION.find((re) => re.test(text));
  if (injected) {
    return decide('ask', `[تنبيه أمني: محاولة حقن نصي محتملة] النص المراد كتابته في ${relPath} يحتوي عبارة تشبه أوامر تخريبية أو إعادة توجيه للوكيل (البند 6). راجع المحتوى قبل الموافقة.`);
  }
  // soft: سؤال حوكمة عادي بلا اشتباه؛ في أداة بلا نافذة موافقة يمرّ ويُبلَّغ عنه بعد التعديل (post-edit.mjs).
  // طبقة الإنفاذ نفسها (Hooks، الإعدادات، سجل Cursor) ليست soft: تعديلها يعطّل الحماية، فيُمنع هناك.
  const soft = !ENFORCEMENT_PATHS.some((re) => re.test(relPath));
  return { ...decide('ask', `🛡️ ${relPath} من ملفات الحوكمة/طبقة الإنفاذ؛ تعديله يغيّر سلوك الوكيل ويحتاج موافقتك الصريحة.`), soft };
}

function checkFileTool(toolName, input) {
  const target = canonicalPath(input.file_path || input.notebook_path || (toolName === 'Grep' ? input.path : '') || '');
  const relPath = toProjectRelative(target) || String(target || '');
  const decisions = [];

  if (target && isServiceAccountFile(target)) {
    return decide('deny', `🔒 حماية الأسرار (البند 5): ${relPath} ملف حساب خدمة (Service Account) بصلاحيات كاملة على مشروع Firebase — لا يقرأه الوكيل ولا يعدّله. مكانه خارج مجلد المشروع، ويُشار إلى مساره فقط عبر متغير البيئة GOOGLE_APPLICATION_CREDENTIALS.`);
  }
  // بحث بنمط glob يطابق ملفات البيئة: سرد الأسماء أو العدّ لا يكشف شيئاً، وعرض الأسطر المطابقة يكشف القيم
  if (toolName === 'Grep' && ENV_GLOB.test(input.glob || '') && !['files_with_matches', 'count'].includes(input.output_mode)) {
    return decide('deny', `🔒 حماية الأسرار (البند 5): هذا البحث يعرض محتوى ملفات البيئة الحقيقية (${input.glob}). ${ENV_ADVICE}`);
  }
  if (target && isRealEnvFile(target)) {
    const exists = existsSync(resolve(projectDir(), String(target)));
    if (toolName !== 'Write' || exists) {
      return decide('deny', `🔒 حماية الأسرار (البند 5): ${toolName === 'Write' ? 'الكتابة فوق' : 'قراءة/تعديل'} ملف البيئة الحقيقي ${relPath} محظورة على الوكيل. ${ENV_ADVICE}`);
    }
  }
  const pathThreat = checkPathThreats(toolName, target);
  if (pathThreat?.permissionDecision === 'deny') return pathThreat;
  decisions.push(pathThreat);
  const text = writtenText(toolName, input);
  if (text) decisions.push(scanSecrets(text, relPath));
  // أداة كتابة على ملف حوكمة تُسأل عنها حتى لو كان النص فارغاً: تفريغ ملف الإعدادات أو حذف نص منه يعطّل الحماية
  if (WRITE_TOOLS.has(toolName) && toProjectRelative(target)) decisions.push(checkInstructionFile(text, relPath));
  return strongest(decisions);
}

function checkShellCommand(command) {
  // على Windows الاسم ‎.env.‎ بنقطة ختامية هو ‎.env‎ نفسه، فتُسقَط النقطة قبل المطابقة
  let remaining = String(command || '').replace(/(\.env(?:\.[A-Za-z0-9_-]+)*)\.+(?=$|[\s'";|&)<>])/gi, '$1');
  for (const safe of SAFE_ENV_COMMANDS) remaining = remaining.replace(safe, ' ');
  const serviceAccounts = remaining.match(SERVICE_ACCOUNT_REFERENCE) || [];
  if (serviceAccounts.length && READ_OR_EXFIL_COMMAND.test(remaining)) {
    return decide('deny', `🔒 حماية الأسرار (البند 5): هذا الأمر يقرأ أو ينقل ملف حساب الخدمة (${[...new Set(serviceAccounts)].join('، ')}). عرض محتواه يسرّب مفتاحاً بصلاحيات كاملة إلى سجل المحادثة.`);
  }
  const references = [...remaining.matchAll(ENV_REFERENCE)].map((m) => m[1]).filter(isRealEnvFile);
  if (!references.length) return null;
  const files = [...new Set(references)].join('، ');
  if (READ_OR_EXFIL_COMMAND.test(remaining)) {
    return decide('deny', `🔒 حماية الأسرار (البند 5): هذا الأمر يقرأ أو ينقل ملف البيئة الحقيقي (${files}). عرض محتواه يسرّب الأسرار إلى سجل المحادثة. ${ENV_ADVICE}`);
  }
  return decide('ask', `🔒 هذا الأمر يشير إلى ملف البيئة الحقيقي (${files}). وافق فقط إذا كنت متأكداً أنه لا يعرض محتواه.`);
}

runHook(async () => {
  const input = await readStdinJson();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const result = toolName === 'Bash' || toolName === 'PowerShell'
    ? strongest([checkShellCommand(toolInput.command), checkCommandThreats(toolInput.command)])
    : checkFileTool(toolName, toolInput);
  if (!result || (result.soft && !hostTraits(input.host).approvalPrompt)) return;
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.permissionDecision,
      permissionDecisionReason: result.reason,
    },
  });
});
