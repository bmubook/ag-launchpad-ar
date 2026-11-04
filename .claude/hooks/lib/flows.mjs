/**
 * حالة التدفق من خانة «الحالة» في فهرس التدفقات (project_map.md §13)، مصدر واحد لملخص الجلسة وخارطة الطريق.
 * الخانة قد تحمل أكثر من رمز (مثل «🟡 قيد العمل — جزء الموشن 🔒»)، فالأسوأ يغلب: تدفق فيه 🔴 أو 🟡 لم يكتمل
 * وإن ظهر فيه 🔒؛ وإلا قرأته الخارطة مكتملاً فقفزت إلى محطة الإطلاق والبناء لم ينتهِ.
 */
export function flowState(cell = '') {
  if (cell.includes('🔴')) return 'broken';
  if (cell.includes('🟡')) return 'doing';
  if (cell.includes('🔒')) return 'done';
  return 'upcoming';
}
