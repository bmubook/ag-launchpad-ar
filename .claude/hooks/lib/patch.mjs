/**
 * قارئ صيغة الرقعة (*** Begin Patch) التي تعدّل بها أداة patch في OpenCode الملفاتِ لبعض النماذج.
 * رقعة واحدة قد تضيف ملفاً وتعدّل آخر وتحذف ثالثاً، فتُفكَّك هنا إلى عملية لكل ملف
 * حتى يفحص الحارس و Hook ما بعد التعديل كل ملف كما لو عُدّل بأداة مستقلة.
 */
const BEGIN = '*** Begin Patch';
const FILE_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const MOVE_HEADER = /^\*\*\* Move to: (.+)$/;

/** نص الرقعة من مدخلات الأداة أياً كان اسم الحقل (اسمه غير موثّق، فيُبحث عن أول نص يبدأ بالترويسة). */
export function findPatchText(input) {
  if (typeof input === 'string') return input.includes(BEGIN) ? input : '';
  if (!input || typeof input !== 'object') return '';
  for (const value of Object.values(input)) {
    const found = findPatchText(value);
    if (found) return found;
  }
  return '';
}

/**
 * يعيد قائمة { op: 'add' | 'update' | 'delete', path, moveTo, added }:
 * added = الأسطر المضافة (بعد إزالة +) — محتوى الملف كاملاً في add، والجديد فقط في update.
 */
export function parsePatch(text) {
  const operations = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const header = line.match(FILE_HEADER);
    if (header) {
      current = { op: header[1].toLowerCase(), path: header[2].trim(), moveTo: null, lines: [] };
      operations.push(current);
      continue;
    }
    if (!current) continue;
    const move = line.match(MOVE_HEADER);
    if (move) current.moveTo = move[1].trim();
    else if (line.startsWith('+')) current.lines.push(line.slice(1));
  }
  return operations.map(({ lines, ...operation }) => ({ ...operation, added: lines.join('\n') }));
}
