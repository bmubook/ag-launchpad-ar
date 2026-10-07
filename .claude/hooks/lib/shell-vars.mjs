/**
 * المتغيرات التي يُسند إليها مسار داخل أمر الطرفية نفسه (‎$p = "$PWD\AGENTS.md"‎ أو p=.claude)، بقيمها بعد التوسيع.
 * كشفتها تجربة حية: النموذج حفظ مسار ملف الحوكمة في متغير ثم كتب فيه، ففلت من المطابقة المباشرة (lib/threats.mjs).
 * التوسيع محدود: أمر من آلاف المتغيرات المتداخلة كان يتضخم حتى تنتهي مهلة الـ Hook فيمرّ دون فحص؛
 * ما يتجاوز الحد يعيد null، فيُسأل المستخدم عن الأمر بدل فحصه.
 */
import { MAX_COMMAND_CHARS } from './patterns.mjs';

const PS_ASSIGNMENT = /\$(?:env:)?([A-Za-z_]\w*)\s*=\s*([^;\n]+)/g;
const SH_ASSIGNMENT = /(?:^|[\s;&|(])([A-Za-z_]\w*)=("[^"]*"|'[^']*'|[^\s;&|)]+)/g;
const MAX_VARIABLES = 100;
const MAX_EXPANDED_CHARS = 2 * MAX_COMMAND_CHARS;

const unquote = (token) => token.replace(/^["']+|["']+$/g, '');

/** يوسّع المتغيرات المعروفة في نص. null إذا تجاوز الناتج الحد (يُحسب قبل الاستبدال فلا تتضخم الذاكرة). */
export function expandVariables(text, values) {
  let expanded = text;
  for (const [name, value] of values) {
    const reference = new RegExp(`\\$\\{?(?:env:)?${name}\\}?(?!\\w)`, 'g');
    const uses = expanded.match(reference)?.length || 0;
    if (!uses) continue;
    if (expanded.length + uses * value.length > MAX_EXPANDED_CHARS) return null;
    expanded = expanded.replace(reference, () => value);
  }
  return expanded;
}

/** Map بالمتغيرات المسندة في الأمر وقيمها الموسّعة، أو null إذا كثرت أو طالت فوق الحد. */
export function assignedValues(command) {
  const assignments = [...command.matchAll(PS_ASSIGNMENT), ...command.matchAll(SH_ASSIGNMENT)].sort((a, b) => a.index - b.index);
  if (assignments.length > MAX_VARIABLES) return null;
  const values = new Map();
  for (const [, name, raw] of assignments) {
    const value = expandVariables(unquote(raw.trim()), values);
    if (value === null) return null;
    values.set(name, value);
  }
  return values;
}
