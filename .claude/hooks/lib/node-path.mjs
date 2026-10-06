/**
 * مسار Node.js لتشغيل Hooks القالب من إضافة OpenCode. تطبيقات سطح المكتب على الماك (المفتوحة من Dock أو Finder)
 * لا ترث PATH الطرفية، فلا ترى node المثبّت عبر Homebrew أو nvm أو Volta؛ لذلك يُبحث في PATH أولاً
 * ثم في أماكن التثبيت الشائعة لكل نظام. null = لم يوجد، فيُنبَّه الوكيل والمستخدم بدل أن تتعطل الحماية بصمت.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

function listDirs(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** v22.21.0 قبل v18.20.4: الأحدث أولاً. */
function newestFirst(a, b) {
  const parts = (version) => version.replace(/^v/, '').split('.').map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
}

function knownLocations({ env, platform, home, list }) {
  if (platform === 'win32') {
    return [
      win32.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'Programs', 'nodejs', 'node.exe'),
      win32.join(env.APPDATA || win32.join(home, 'AppData', 'Roaming'), 'nvm', 'nodejs', 'node.exe'),
      win32.join(home, 'scoop', 'shims', 'node.exe'),
    ];
  }
  const nvmRoot = posix.join(home, '.nvm', 'versions', 'node');
  const nvm = list(nvmRoot).sort(newestFirst).map((version) => posix.join(nvmRoot, version, 'bin', 'node'));
  return [
    '/opt/homebrew/bin/node', '/usr/local/bin/node',
    posix.join(home, '.volta', 'bin', 'node'), ...nvm,
    posix.join(home, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin', 'node'),
    posix.join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node'),
    posix.join(home, '.asdf', 'shims', 'node'), posix.join(home, '.local', 'share', 'mise', 'shims', 'node'),
    '/usr/bin/node',
  ];
}

/** يعيد أول مسار موجود لـ node، أو null. الخيارات قابلة للاستبدال لمحاكاة نظام آخر في الاختبارات. */
export function findNode({ env = process.env, platform = process.platform, home = homedir(), exists = existsSync, list = listDirs } = {}) {
  const path = platform === 'win32' ? win32 : posix;
  const exe = platform === 'win32' ? 'node.exe' : 'node';
  const fromPath = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, exe));
  return [...fromPath, ...knownLocations({ env, platform, home, list })].find((candidate) => exists(candidate)) || null;
}
