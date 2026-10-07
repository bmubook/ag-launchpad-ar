/**
 * بصمة ملفات الحوكمة، خط الدفاع الثاني لطبقة الحماية: تُقارن بصمة بداية الجولة (prompt-submit.mjs) ببصمة نهايتها
 * (stop-gate.mjs) لمعرفة ما تغيّر محتواه فعلاً بأمر طرفية لم يتعرف عليه الحارس.
 * لا تمر بمسح المشروع العام ولا بقواعد التجاهل: ملفات حرجة تُقرأ بأسمائها، ومجلدات الحماية يُمسح كل منها بحد مستقل،
 * وملفات التعليمات تُبحث بالاسم في كل المجلدات؛ فلا يُخفيها استنفاد حد المسح بملفات حشو (مراجعة الأمن).
 * الكتابة في كل هذه الأماكن تتطلب موافقة المستخدم، فلا تُحشى هي نفسها دون علمه.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { IGNORED_DIRS, MAX_SCAN, walkDisk } from './files.mjs';

const CRITICAL_FILES = [
  '.claude/settings.json', '.claude/settings.local.json', '.claude/statusline.mjs', '.claude/launchpad.json',
  'CLAUDE.md', 'AGENTS.md', 'master_rules.md', 'rules_security.md', 'rules_code_quality.md', 'rules_workflow.md', 'rules_ui.md',
  '.cursorignore', 'opencode.json', 'opencode.jsonc',
];
const GOVERNANCE_DIRS = [
  '.claude/hooks', '.claude/scripts', '.claude/skills', '.claude/agents', '.claude/rules', '.claude/launchpad',
  '.agents', '.cursor', '.opencode', 'skills',
];
const INSTRUCTION_NAME = /^(CLAUDE|AGENTS)\.md$/i;
// مسح الأسماء وحدها رخيص (قراءة المجلدات دون فتح الملفات)، فحده أكبر بكثير من حد المسح العام
const MAX_NAME_ENTRIES = 200000;

/** CLAUDE.md و AGENTS.md في أي مجلد، بالأسماء وحدها: Claude Code يحمّل ملف التعليمات الفرعي ولو تجاهله Git. */
function instructionFiles(root) {
  const found = [];
  const dirs = [root];
  let budget = MAX_NAME_ENTRIES;
  for (let index = 0; index < dirs.length && budget > 0; index += 1) {
    let entries = [];
    try { entries = readdirSync(dirs[index], { withFileTypes: true }); } catch { continue; }
    budget -= entries.length;
    for (const entry of entries) {
      const full = join(dirs[index], entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) dirs.push(full);
      } else if (entry.isFile() && INSTRUCTION_NAME.test(entry.name)) {
        found.push(relative(root, full).replace(/\\/g, '/'));
      }
    }
  }
  return found;
}

/** ملفات الحوكمة المرشحة للبصمة: الملفات الحرجة بأسمائها، وملفات التعليمات في كل مكان، ومجلدات الحماية كاملة. */
function governanceCandidates(root) {
  const candidates = new Set(CRITICAL_FILES.filter((rel) => existsSync(join(root, rel))));
  for (const rel of instructionFiles(root)) candidates.add(rel);
  for (const dir of GOVERNANCE_DIRS) {
    for (const rel of walkDisk(root, join(root, dir), { left: MAX_SCAN })) candidates.add(rel);
  }
  return candidates;
}

/**
 * بصمة محتوى كل ملف يطابق أحد patterns: { المسار: sha256 }. وقت التعديل لا يكفي هنا،
 * لأن أوامر Git (الانتقال بين الفروع، الدمج) تعيد كتابة الملفات بالمحتوى نفسه.
 */
export function fingerprint(root, patterns) {
  const prints = {};
  for (const rel of governanceCandidates(root)) {
    if (!patterns.some((re) => re.test(rel))) continue;
    try { prints[rel] = createHash('sha256').update(readFileSync(join(root, rel))).digest('hex'); } catch { /* حُذف أثناء المسح */ }
  }
  return prints;
}

/** الملفات التي أُضيفت أو حُذفت أو تغيّر محتواها بين بصمتين. */
export function changedPrints(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((rel) => before[rel] !== after[rel]).sort();
}
