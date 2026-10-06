/**
 * يبني docs/roadmap.html: صفحة واحدة مكتفية بذاتها (البيانات داخلها لا في ملف منفصل)، تُفتح بالنقر المزدوج
 * دون خادم ولا إنترنت. القالب في template.html، والبيانات من data.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { roadmapData } from './data.mjs';

export const ROADMAP_FILE = 'docs/roadmap.html';
const TEMPLATE = new URL('./template.html', import.meta.url);
const SAFE_HEX = /^#[0-9a-f]{6}$/;

/** HTML الصفحة من بياناتها. ‎<‎ يُهرَّب داخل JSON حتى لا يُغلق اسمٌ مثل ‎</script>‎ وسم البيانات. */
export function roadmapHtml(data) {
  const color = (value, fallback) => (SAFE_HEX.test(value) ? value : fallback);
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return readFileSync(TEMPLATE, 'utf8')
    .replace('__BRAND__', color(data.brand, '#4f46e5'))
    .replace('__BRAND_INK__', color(data.brandInk, '#ffffff'))
    .replace('__ACCENT_LIGHT__', color(data.accentLight, '#4f46e5'))
    .replace('__ACCENT_DARK__', color(data.accentDark, '#a5b4fc'))
    .replace('__ACCENT_INK_LIGHT__', color(data.accentInkLight, '#ffffff'))
    .replace('__ACCENT_INK_DARK__', color(data.accentInkDark, '#111827'))
    .replace('__ROADMAP_DATA__', () => json);
}

/** يكتب الخارطة في مشروع root ويعيد { path, created, data }؛ لا يعيد الكتابة إن لم يتغير شيء. */
export function writeRoadmap(root) {
  const data = roadmapData(root);
  const html = roadmapHtml(data);
  const path = join(root, ROADMAP_FILE);
  const created = !existsSync(path);
  if (created || readFileSync(path, 'utf8') !== html) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, 'utf8');
  }
  return { path, created, data };
}
