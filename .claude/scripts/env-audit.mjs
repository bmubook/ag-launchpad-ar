#!/usr/bin/env node
/**
 * الفحص البيئي (البند 10 — rules_workflow.md) — يعمل على Windows و macOS و Linux دون اعتماديات.
 * الاستخدام: node .claude/scripts/env-audit.mjs          ← مخرجات Markdown عربية لقسم البيئة في project_map.md
 *            node .claude/scripts/env-audit.mjs --json   ← مخرجات JSON
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';

const TOOLS = [
  { name: 'Node.js', command: 'node --version', min: 18 },
  { name: 'npm', command: 'npm --version' },
  { name: 'pnpm', command: 'pnpm --version' },
  { name: 'Yarn', command: 'yarn --version' },
  { name: 'Python', command: ['python --version', 'python3 --version', 'py --version'] },
  { name: 'Git', command: 'git --version' },
  { name: 'Flutter', command: 'flutter --version', timeout: 60000 },
  { name: 'Dart', command: 'dart --version' },
  { name: 'Firebase CLI', command: 'firebase --version', timeout: 30000 },
  { name: 'FlutterFire CLI', command: 'flutterfire --version' },
  { name: 'Java (لمحاكيات Firebase)', command: 'java -version 2>&1', min: 21 },
];

/* منافذ التطوير الشائعة + منافذ محاكيات Firebase الافتراضية:
   4000 واجهة المحاكيات، 5001 Functions، 8080 Firestore، 9099 Auth، 9199 Storage. */
const DEV_PORTS = [3000, 3001, 4000, 4200, 5000, 5001, 5173, 8000, 8080, 8081, 9099, 9199];
const MISSING = 'غير مثبت';

function run(command, timeout = 15000) {
  try {
    const out = execSync(command, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() || null;
  } catch (error) {
    const fallback = `${error.stdout || ''}${error.stderr || ''}`.trim();
    return error.status === 0 && fallback ? fallback : null;
  }
}

function firstVersion(output) {
  if (!output) return MISSING;
  const line = output.split(/\r?\n/).find((l) => /\d+\.\d+/.test(l)) || output.split(/\r?\n/)[0];
  const match = line.match(/\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?/);
  return match ? match[0] : line.trim().slice(0, 40);
}

function toolVersion(tool) {
  const commands = Array.isArray(tool.command) ? tool.command : [tool.command];
  for (const command of commands) {
    const output = run(command, tool.timeout);
    if (output && !/not recognized|not found|No such file|was not found/i.test(output)) return firstVersion(output);
  }
  return MISSING;
}

function osDescription() {
  const platform = os.platform();
  if (platform === 'darwin') {
    const version = run('sw_vers -productVersion');
    return `macOS ${version || os.release()}`;
  }
  if (platform === 'linux') {
    const release = run('cat /etc/os-release');
    const pretty = release && (release.match(/^PRETTY_NAME="?([^"\n]+)"?/m) || [])[1];
    return pretty || `Linux ${os.release()}`;
  }
  return typeof os.version === 'function' ? `${os.version()} (${os.release()})` : `${os.type()} ${os.release()}`;
}

function shellDescription() {
  if (os.platform() !== 'win32') return process.env.SHELL || 'غير معروف';
  if (process.env.MSYSTEM || /bash/i.test(process.env.SHELL || '')) return 'Git Bash ✅ (الـ Hooks تعمل)';
  const bash = run('bash --version');
  return bash ? 'Git Bash متاح ✅' : 'PowerShell فقط ⚠️ — ثبّت Git for Windows لتعمل الـ Hooks';
}

function portStatus(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', (error) => done(['EADDRINUSE', 'EACCES'].includes(error.code) ? 'busy' : 'unknown'));
    server.once('listening', () => server.close(() => done('free')));
    server.listen(port, '127.0.0.1');
  });
}

async function audit() {
  const ports = [];
  for (const port of DEV_PORTS) ports.push({ port, status: await portStatus(port) });
  return {
    os: osDescription(),
    arch: os.arch(),
    shell: shellDescription(),
    tools: TOOLS.map((tool) => {
      const version = toolVersion(tool);
      const major = parseInt(version, 10);
      return { name: tool.name, version, min: tool.min || null, tooOld: Boolean(tool.min && major && major < tool.min) };
    }),
    ports,
  };
}

/** خانة الإصدار: غير مثبت، أو أقدم من الحد الأدنى الذي يتطلبه القالب (⚠️)، أو سليم. */
function toolCell(t) {
  if (t.version === MISSING) return `⬜ ${MISSING}`;
  return t.tooOld ? `⚠️ \`${t.version}\` — يلزم ${t.min} أو أحدث` : `\`${t.version}\``;
}

function toMarkdown(result) {
  const portLabel = { free: '🟢 متاح', busy: '🔴 مشغول', unknown: '⚪ غير معروف' };
  const lines = [
    `* **نظام التشغيل المكتشف:** ${result.os} — ${result.arch}`,
    `* **الطرفية (Shell):** ${result.shell}`,
    '* **إصدارات الأدوات:**',
    '',
    '| الأداة | الإصدار |',
    '| :--- | :--- |',
    ...result.tools.map((t) => `| ${t.name} | ${toolCell(t)} |`),
    '',
    '* **منافذ التطوير الشائعة (Ports):**',
    '',
    '| المنفذ | الحالة |',
    '| :---: | :--- |',
    ...result.ports.map((p) => `| ${p.port} | ${portLabel[p.status]} |`),
  ];
  return lines.join('\n');
}

const result = await audit();
process.stdout.write(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : `${toMarkdown(result)}\n`);
