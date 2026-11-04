/**
 * تحديث خارطة الطريق (docs/roadmap.html) من الـ Hooks. يستدعيه post-edit بعد تعديل مصادرها بأداة التعديل،
 * و stop-gate في نهاية كل رد: التوثيق المكتوب بسكربت أو أمر طرفية لا يمرّ بـ post-edit، فتبقى الخارطة قديمة دون أن يلاحظ أحد.
 */
export const ROADMAP_SOURCES = new Set(['project_map.md', 'changelog.md']);

const ROADMAP_CREATED = '🗺️ أُنشئت خارطة الطريق docs/roadmap.html، وتتحدث تلقائياً كلما تغيّر project_map.md. '
  + 'أخبر المستخدم في ردك بجملة واحدة أنه يرى منها أين وصل مشروعه: يفتحها بالنقر المزدوج، أو تفتحها له بالأمر node .claude/scripts/roadmap.mjs --open.';

/**
 * يعيد كتابة الخارطة إن تغيّرت مصادرها، ويعيد رسالة للوكيل عند أول إنشاء فقط. أي فشل هنا لا يوقف الجلسة.
 * الاستيراد عند الحاجة فقط: حقيبة الحارس لا تحمل سكربتات الخارطة.
 */
export async function refreshRoadmap(root) {
  try {
    const { writeRoadmap } = await import('../../scripts/roadmap/page.mjs');
    return writeRoadmap(root).created ? ROADMAP_CREATED : null;
  } catch {
    return null;
  }
}
