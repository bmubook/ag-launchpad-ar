#!/usr/bin/env node
/**
 * يفتح مولّد الإقلاع SETUP_GUIDE.html في المتصفح الافتراضي (Windows / macOS / Linux).
 * الاستخدام: node .claude/scripts/open-setup.mjs            ← يفتح الملف
 *            node .claude/scripts/open-setup.mjs --dry-run  ← يطبع الأمر دون تنفيذ (للاختبار)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const file = join(root, 'SETUP_GUIDE.html');

function openerFor(platform) {
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/c', 'start', '""', `"${file}"`], options: { windowsVerbatimArguments: true } };
  if (platform === 'darwin') return { command: 'open', args: [file], options: {} };
  return { command: 'xdg-open', args: [file], options: {} };
}

if (!existsSync(file)) {
  process.stdout.write('❌ لم أجد SETUP_GUIDE.html في جذر المشروع — تأكد أنك فتحت مجلد المشروع الصحيح.\n');
  process.exit(1);
}

const opener = openerFor(process.platform);
if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${opener.command} ${opener.args.join(' ')}\n`);
  process.exit(0);
}

const child = spawn(opener.command, opener.args, { ...opener.options, detached: true, stdio: 'ignore', windowsHide: true });
child.once('spawn', () => {
  child.unref();
  process.stdout.write(`✅ فُتح مولّد الإقلاع في المتصفح: ${file}\n`);
});
child.once('error', () => {
  process.stdout.write(`⚠️ تعذّر فتح المتصفح تلقائياً. افتح هذا الملف يدوياً بالنقر المزدوج:\n${file}\n`);
});
