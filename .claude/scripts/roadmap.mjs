#!/usr/bin/env node
/**
 * خارطة الطريق التفاعلية: يولّد docs/roadmap.html من project_map.md ليرى صاحب المشروع أين وصل.
 * تُحدَّث تلقائياً بعد كل تعديل على project_map.md أو changelog.md (Hook ما بعد التعديل)، ويشغّلها /document
 * في البيئات التي لا تعمل فيها الـ Hooks.
 * الاستخدام: node .claude/scripts/roadmap.mjs          ← يولّد الخارطة
 *            node .claude/scripts/roadmap.mjs --open   ← يولّدها ويفتحها في المتصفح
 */
import { resolve } from 'node:path';
import { openInBrowser } from './lib/browser.mjs';
import { writeRoadmap } from './roadmap/page.mjs';

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const { path, data } = writeRoadmap(root);
const current = data.stations.find((station) => station.status === 'current');
process.stdout.write(`🗺️ خارطة الطريق: ${path}\n`
  + `   التقدم الكلي ${data.overall}% · المحطة الحالية: ${current ? current.name : 'اكتملت الرحلة'} · الخطوة التالية: ${data.next.command}\n`);
if (process.argv.includes('--open') || process.argv.includes('--dry-run-open')) {
  openInBrowser(path, 'خارطة الطريق', { dryRun: process.argv.includes('--dry-run-open') });
}
