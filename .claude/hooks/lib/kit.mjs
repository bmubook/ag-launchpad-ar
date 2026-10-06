/**
 * حقيبة الحارس (Guard Kit): حواجز القالب وحدها، تُركَّب في .claude/launchpad/ داخل مشروع قائم بالأمر
 * node .claude/scripts/guard-install.mjs <مسار المشروع>. لا ملفات حاكمة فيها ولا project_map.md ولا سجلات؛
 * الوضع وأوامر الفحص وسقف الحجم تأتي من .claude/launchpad.json.
 * الحقيبة تُعرف من مكان هذا الملف لا من الإعداد: حذف ملف الإعداد لا يعيد الحارس إلى سلوك القالب الكامل.
 * بلا اعتماديات، ولا تستورد common.mjs (هو من يستوردها).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUARD_KIT = fileURLToPath(import.meta.url).replace(/\\/g, '/').includes('/.claude/launchpad/hooks/lib/');
/** مجلد طبقة الإنفاذ من جذر المشروع: .claude في القالب، و .claude/launchpad في الحقيبة. */
export const GUARD_HOME = GUARD_KIT ? '.claude/launchpad' : '.claude';
export const CONFIG_FILE = '.claude/launchpad.json';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** إعداد الحارس: اختياري في القالب (أوامر الفحص) وفي الحقيبة (الوضع والأوامر والسقوف). ملف تالف = لا إعداد. */
export function readGuardConfig(root) {
  try {
    const data = JSON.parse(readFileSync(join(root, CONFIG_FILE), 'utf8'));
    return isObject(data) ? data : {};
  } catch {
    return {};
  }
}

/** حالة المشروع في الحقيبة: لا إقلاع ولا اسم نداء ولا إرشاد للمبتدئ، والوضع production ما لم يُكتب prototype. */
export function kitProjectState(root) {
  const config = readGuardConfig(root);
  return {
    projectName: null, projectType: null, callSign: null, phase: null, experience: null,
    mode: config.mode === 'prototype' ? 'prototype' : 'production',
    learning: null, suggestions: false, backlogOpen: 0, kickedOff: false, mapFound: false,
    kit: true, ceilings: config.ceilings === true,
  };
}

/** أمر الفحص المناسب للوضع: production يتطلب الفحص الكامل، و prototype يكفيه السريع. */
export const verifyCommand = (mode) => `node ${GUARD_HOME}/scripts/verify.mjs${mode === 'prototype' ? ' --quick' : ''}`;
