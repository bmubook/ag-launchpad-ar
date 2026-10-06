/**
 * فتح ملف HTML محلي في المتصفح الافتراضي (Windows / macOS / Linux). يشترك فيه مولّد الإقلاع وخارطة الطريق.
 */
import { spawn } from 'node:child_process';

export function openerFor(platform, file) {
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/d', '/c', 'start', '""', `"${file}"`], options: { windowsVerbatimArguments: true } };
  if (platform === 'darwin') return { command: 'open', args: [file], options: {} };
  return { command: 'xdg-open', args: [file], options: {} };
}

/** يفتح الملف، أو يطبع الأمر فقط مع dryRun. label يظهر في رسالة النجاح. */
export function openInBrowser(file, label, { dryRun = false, platform = process.platform } = {}) {
  const opener = openerFor(platform, file);
  if (dryRun) {
    process.stdout.write(`${opener.command} ${opener.args.join(' ')}\n`);
    return;
  }
  const child = spawn(opener.command, opener.args, { ...opener.options, detached: true, stdio: 'ignore', windowsHide: true });
  child.once('spawn', () => {
    child.unref();
    // «تم فتح» تصلح للمذكّر (مولّد الإقلاع) والمؤنث (خارطة الطريق)
    process.stdout.write(`✅ تم فتح ${label} في المتصفح: ${file}\n`);
  });
  child.once('error', () => {
    process.stdout.write(`⚠️ تعذّر فتح المتصفح تلقائياً. افتح هذا الملف يدوياً بالنقر المزدوج:\n${file}\n`);
  });
}
