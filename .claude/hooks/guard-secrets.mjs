#!/usr/bin/env node
/**
 * Hook الحارس الأمني (PreToolUse) — البندان 5 و 6 في rules_security.md:
 * - يمنع قراءة/تعديل ملفات البيئة الحقيقية (.env) ويمنع الكتابة فوق .env موجود.
 * - يمنع كتابة مفاتيح سرية مؤكدة داخل الملفات، ويسأل المستخدم عند الاشتباه.
 * - يمنع أوامر الطرفية التي تقرأ .env، ويسأل عن أي إشارة أخرى إليه.
 * - يسأل المستخدم قبل أي كتابة في ملفات التعليمات/الحوكمة، مع تنبيه حقن نصي إن وُجد.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  emit, isRealEnvFile, projectDir, readStdinJson, runHook, toProjectRelative,
} from './lib/common.mjs';
import {
  ENV_REFERENCE, INJECTION, INJECTION_SCAN_EXEMPT, PROTECTED_INSTRUCTION_PATHS, READ_OR_EXFIL_COMMAND,
  SAFE_ENV_COMMANDS, SECRET_HIGH, SECRET_MEDIUM,
} from './lib/patterns.mjs';

const ENV_ADVICE = 'أضف المفاتيح الجديدة بقيم فارغة إلى .env.example، واطلب من المستخدم نسخها إلى .env وتعبئتها بنفسه.';
const SEVERITY = { allow: 0, ask: 1, deny: 2 };

function decide(permissionDecision, reason) {
  return { permissionDecision, reason };
}

function strongest(decisions) {
  return decisions.filter(Boolean).sort((a, b) => SEVERITY[b.permissionDecision] - SEVERITY[a.permissionDecision])[0] || null;
}

/** النصوص التي ستُكتب فعلاً حسب نوع الأداة. */
function writtenText(toolName, input) {
  if (toolName === 'Write') return input.content || '';
  if (toolName === 'Edit') return input.new_string || '';
  if (toolName === 'MultiEdit') return (input.edits || []).map((e) => e.new_string || '').join('\n');
  if (toolName === 'NotebookEdit') return input.new_source || '';
  return '';
}

function scanSecrets(text, relPath) {
  const high = SECRET_HIGH.find((p) => p.re.test(text));
  if (high) {
    return decide('deny', `🔒 حماية الأسرار (البند 5 — rules_security.md): المحتوى المراد كتابته في ${relPath} يحتوي على ما يبدو ${high.name}. يُحظر وضع المفاتيح داخل الملفات؛ استدعِها من متغيرات البيئة. ${ENV_ADVICE}`);
  }
  for (const pattern of SECRET_MEDIUM) {
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
  return decide('ask', `🛡️ ${relPath} من ملفات الحوكمة/طبقة الإنفاذ؛ تعديله يغيّر سلوك الوكيل ويحتاج موافقتك الصريحة.`);
}

function checkFileTool(toolName, input) {
  const target = input.file_path || input.notebook_path || (toolName === 'Grep' ? input.path : '');
  const relPath = toProjectRelative(target) || String(target || '');
  const decisions = [];

  if (target && isRealEnvFile(target)) {
    const exists = existsSync(resolve(projectDir(), String(target)));
    if (toolName !== 'Write' || exists) {
      return decide('deny', `🔒 حماية الأسرار (البند 5): ${toolName === 'Write' ? 'الكتابة فوق' : 'قراءة/تعديل'} ملف البيئة الحقيقي ${relPath} محظورة على الوكيل. ${ENV_ADVICE}`);
    }
  }
  const text = writtenText(toolName, input);
  if (text) {
    decisions.push(scanSecrets(text, relPath));
    if (toProjectRelative(target)) decisions.push(checkInstructionFile(text, relPath));
  }
  return strongest(decisions);
}

function checkShellCommand(command) {
  let remaining = String(command || '');
  for (const safe of SAFE_ENV_COMMANDS) remaining = remaining.replace(safe, ' ');
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
    ? checkShellCommand(toolInput.command)
    : checkFileTool(toolName, toolInput);
  if (!result) return;
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.permissionDecision,
      permissionDecisionReason: result.reason,
    },
  });
});
