#!/usr/bin/env node
/**
 * يفتح مولّد الإقلاع SETUP_GUIDE.html في المتصفح الافتراضي (Windows / macOS / Linux).
 * الاستخدام: node .claude/scripts/open-setup.mjs            ← يفتح الملف
 *            node .claude/scripts/open-setup.mjs --dry-run  ← يطبع الأمر دون تنفيذ (للاختبار)
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openInBrowser } from './lib/browser.mjs';

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const file = join(root, 'SETUP_GUIDE.html');

if (!existsSync(file)) {
  process.stdout.write('❌ لم أجد SETUP_GUIDE.html في جذر المشروع — تأكد أنك فتحت مجلد المشروع الصحيح.\n');
  process.exit(1);
}

openInBrowser(file, 'مولّد الإقلاع', { dryRun: process.argv.includes('--dry-run') });
