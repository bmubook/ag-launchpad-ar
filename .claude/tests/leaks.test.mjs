// اختبارات دروس المشاريع الحقيقية (docs/research-lessons-2026-11.md): أسرار نُسخت إلى رسائل الإيداع وملفات التوثيق،
// ومفاتيح خدمات لم يعرفها الحارس، وملفات مفاتيح آبل وجوجل في جذر المشروع، وعرض متغيرات البيئة،
// وحارس يسمح بصمت إذا انكسر أحد ملفاته (الفشل المغلق).
// تُشغَّل ضمن hooks.test.mjs، أو وحدها: node .claude/tests/leaks.test.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO, check, decision, freshProject, reason, report, runNode, tmp } from './helpers.mjs';

freshProject({ kicked: true });
process.env.CLAUDE_PROJECT_DIR = tmp;
const lib = (file) => import(pathToFileURL(join(REPO, '.claude/hooks/lib', file)).href);
const { checkCommandThreats } = await lib('threats.mjs');
const { HOOK_FAILED, runHook, strongestDecision } = await lib('opencode.mjs');
const verdict = (result) => (result ? result.permissionDecision : 'allow');
const GUARD = '.claude/hooks/guard-secrets.mjs';
const inClaude = (tool_name, tool_input) => runNode(GUARD, { session_id: 'lk', hook_event_name: 'PreToolUse', tool_name, tool_input });
const inCursor = (tool_name, tool_input) => runNode(GUARD,
  { conversation_id: 'lk', cursor_version: '3.12.17', hook_event_name: 'preToolUse', tool_name: tool_name === 'Bash' ? 'Shell' : tool_name, tool_input },
  { args: ['--host=cursor'] });
const says = (r) => decision(r) || 'allow';

// قيم بالشكل الصحيح تُركَّب من أجزاء حتى لا يوقف الحارس كتابة هذا الملف نفسه
const FAKE = {
  groq: 'gsk' + '_' + 'Ab12'.repeat(13),
  supabasePat: 'sbp' + '_' + 'a1b2c3d4e5'.repeat(4),
  elevenlabs: 'sk' + '_' + '0123456789abcdef'.repeat(3),
  huggingface: 'hf' + '_' + 'AbCdEfGhIj'.repeat(4),
  oauth: 'GOC' + 'SPX-' + 'Ab12Cd34Ef56Gh78Ij90Kl12',
  google: 'AI' + 'zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
};

// ---------- مفاتيح جديدة يعرفها الحارس، في الكود والتوثيق
for (const [name, key] of Object.entries(FAKE).filter(([name]) => name !== 'google')) {
  const r = inClaude('Write', { file_path: join(tmp, 'src/config.js'), content: `export const key = '${key}';` });
  check(`LEAK: ${name} key written in code → deny`, says(r) === 'deny', r.out + r.err);
}
let r = inClaude('Edit', { file_path: join(tmp, 'bugs_log.md'), old_string: 'x', new_string: `| 18 | المفتاح القديم ${FAKE.groq} كان مكشوفاً |` });
check('LEAK: a key copied into bugs_log.md → deny (the agent documented a real key in masboor)', says(r) === 'deny' && reason(r).includes('التوثيق'), r.out);

// ---------- مفاتيح داخل أوامر الطرفية: رسائل الإيداع وكتابة الملفات
const COMMAND_CASES = [
  ['a key inside a commit message', `git commit -m "fix: replace ${FAKE.supabasePat}"`, 'deny'],
  ['a key echoed into a notes file', `echo "${FAKE.elevenlabs}" >> notes.md`, 'deny'],
  ['a key inside a request URL', `curl "https://api.example.com/v1?key=${FAKE.groq}"`, 'deny'],
  ['a Google key in a command (may be public Firebase config)', `curl "https://example.com/?key=${FAKE.google}"`, 'ask'],
  ['LEGIT: a commit message that names the key without its value', 'git commit -m "fix: read the Groq key from GROQ_API_KEY"', 'allow'],
];
for (const [name, command, expected] of COMMAND_CASES) {
  const c = inClaude('Bash', { command });
  check(`LEAK Bash: ${name} → ${expected}`, says(c) === expected, c.out + c.err);
}

// ---------- أسرار بلا شكل ثابت داخل الأوامر: «Yes, and don't ask again» يحفظ الأمر بحروفه في .claude/settings.local.json
// (Apiiro، 2026-11: 1,122 نسخة من هذا الملف فيها أسرار في مستودعات GitHub العامة)
const JWT = 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJyb2xlIjoic2VydmljZSJ9' + '.abcdefghijklmnop';
const SAVED_SECRET_CASES = [
  ['a password inside a database URL', 'psql postgresql://admin:S3cretPassw0rd@db.example.com:5432/app', 'ask'],
  ['a password glued to mysql -p', 'mysql -u root -pS3cretPassw0rd -h db.example.com', 'ask'],
  ['a --password option', 'mysqldump --password=S3cretPassw0rd app > dump.sql', 'ask'],
  ['a --token option', 'vercel deploy --token Ab12Cd34Ef56Gh78Ij90', 'ask'],
  ['a JWT bearer token', `curl -H "Authorization: Bearer ${JWT}" https://x.supabase.co/rest/v1/items`, 'ask'],
  ['an opaque bearer token', 'curl -H "Authorization: Bearer Ab12Cd34Ef56Gh78Ij90Kl12" https://api.example.com', 'ask'],
  ['a secret in an inline variable', 'API_TOKEN=abcd1234efgh5678ijkl npm run deploy', 'ask'],
  ['a secret in a PowerShell variable', '$env:STRIPE_SECRET="abcd1234efgh5678ijkl"; npm run deploy', 'ask'],
  ['a secret in a URL query', 'curl "https://api.example.com/v1/items?access_token=abcd1234efgh5678ijkl"', 'ask'],
  ['force-adding the local settings file to Git', 'git add -f .claude/settings.local.json', 'deny'],
  ['force-adding the whole .claude folder', 'git add --force .claude/', 'deny'],
  ['force-adding everything, ignored files included', 'git add -f -A && git commit -m "all"', 'deny'],
  ['LEGIT: a local database with its default password', 'psql postgresql://postgres:postgres@localhost:54322/postgres', 'allow'],
  ['LEGIT: mysql asks for the password itself', 'mysql -u root -p -h db.example.com', 'allow'],
  ['LEGIT: the token comes from a variable', 'curl -H "Authorization: Bearer $SUPABASE_TOKEN" https://x.supabase.co', 'allow'],
  ['LEGIT: a variable that copies another variable', 'API_TOKEN=$API_TOKEN npm run deploy', 'allow'],
  ['LEGIT: an ordinary inline variable', 'NODE_ENV=production npm run build', 'allow'],
  ['LEGIT: a --token option read from the environment', 'vercel deploy --token "$VERCEL_TOKEN"', 'allow'],
  ['LEGIT: docker publishes a port', 'docker run -p8080:80 nginx', 'allow'],
  ['LEGIT: a placeholder in an example command', 'API_KEY=your-api-key-here npm start', 'allow'],
  ['LEGIT: committing the shared settings file', 'git add .claude/settings.json', 'allow'],
  ['LEGIT: force-adding one build file', 'git add -f dist/app.js', 'allow'],
  // خطأ ظهر لحظة الكتابة: ملاحظة تُكتب بـ heredoc وتذكر الأمر نصاً كانت تُرفض
  ['LEGIT: a note that mentions "git add -f .claude/" as text', "cat >> notes.md <<'EOF'\nيمنع الحارس git add -f للملف و.claude/\nEOF", 'allow'],
  ['LEGIT: a commit message that mentions the blocked command', 'git commit -m "fix(guard): block git add -f .claude/"', 'allow'],
  ['force-adding after another command', 'npm test && git add -f .claude/settings.local.json', 'deny'],
];
for (const [name, command, expected] of SAVED_SECRET_CASES) {
  const c = inClaude('Bash', { command });
  check(`SAVED Bash: ${name} → ${expected}`, says(c) === expected, c.out + c.err);
}
r = inClaude('Bash', { command: 'API_TOKEN=abcd1234efgh5678ijkl npm run deploy' });
check('SAVED: the ask explains that "don\'t ask again" stores the secret in plain text', reason(r).includes('settings.local.json') && reason(r).includes('.env'), reason(r));
check('SAVED Cursor: a secret in a command → refused (no approval window)', inCursor('Bash', { command: 'API_TOKEN=abcd1234efgh5678ijkl npm run deploy' }).json?.permission === 'deny');

// ---------- ملفات مفاتيح آبل وجوجل في جذر المشروع (Native Prime، raho، toyorsa)
check('LEAK: Read an Apple .p8 key → deny', says(inClaude('Read', { file_path: join(tmp, 'AuthKey_ABC123.p8') })) === 'deny');
check('LEAK: Read a Google OAuth client_secret json → deny', says(inClaude('Read', { file_path: join(tmp, 'client_secret_1234-abc.apps.googleusercontent.com.json') })) === 'deny');
check('LEAK: cat an Apple .p8 key → deny', verdict(checkCommandThreats('cat AuthKey_ABC123.p8')) === 'deny');
check('LEAK: LEGIT read google-services.json → allow', says(inClaude('Read', { file_path: join(tmp, 'android/app/google-services.json') })) === 'allow');

// ---------- عرض متغيرات البيئة
const ENV_CASES = [
  ['printenv', 'ask'], ['printenv OPENAI_API_KEY', 'ask'], ['env', 'ask'], ['env | grep KEY', 'ask'], ['npm test && env', 'ask'],
  ['set', 'ask'], ['export -p', 'ask'], ['Get-ChildItem env:', 'ask'], ['gci env:', 'ask'], ['Get-ChildItem -Path env:', 'ask'],
  ['[Environment]::GetEnvironmentVariables()', 'ask'],
  // صيغ قريبة وجدها مراجع الأمن تتخطى النسخة الأولى
  ['bash -c env', 'ask'], ['bash -lc "printenv"', 'ask'], ['cmd /c set', 'ask'], ['env -0', 'ask'], ['export', 'ask'],
  ['declare -p', 'ask'], ['compgen -e', 'ask'], ['node -e "console.log(process.env)"', 'ask'],
  ['python -c "import os; print(os.environ)"', 'ask'], ['cat /proc/self/environ', 'ask'],
  ['set -euo pipefail', 'allow'], ['bash -c "npm test"', 'allow'], ['python -c "import os; print(os.environ.get(\'HOME\'))"', 'allow'],
  ['env NODE_ENV=test npm test', 'allow'], ['Set-Location src', 'allow'], ['export PATH=$PATH:/opt/bin', 'allow'],
  ['node -e "console.log(process.env.HOME)"', 'allow'], ['npm run env:check', 'allow'], ['git config --get user.name', 'allow'],
];
for (const [command, expected] of ENV_CASES) {
  check(`ENV: \`${command}\` → ${expected}`, verdict(checkCommandThreats(command)) === expected, verdict(checkCommandThreats(command)));
}

// ---------- الزمن خطي: نص يُبطئ الحارس حتى تنتهي مهلته يمرّ دون فحص
const slow = (fn) => { const start = performance.now(); fn(); return performance.now() - start; };
const padded = `;${' '.repeat(4000)}`.repeat(2) + 'x'.repeat(1000);
check('ENV ReDoS: separators padded with spaces stay fast', slow(() => checkCommandThreats(padded)) < 1000);
const { ENV_DUMP } = await lib('patterns.mjs');
const wrappers = `;bash${' -c'.repeat(3000)}${' '.repeat(3000)}x`;
const quoted = `;env${' '.repeat(5000)}"${' '.repeat(5000)}x`;
check('ENV ReDoS: wrapper options and padded quotes stay fast', slow(() => [wrappers, quoted].forEach((t) => ENV_DUMP.test(t))) < 500);
check('LIMIT: a multi-line commit message with a line that is only "env" is asked about', verdict(checkCommandThreats('git commit -m "docs: explain\nenv\n"')) === 'ask');
const keyish = `${'gsk_'.repeat(2000)}`;
const { SECRET_HIGH } = await lib('patterns.mjs');
check('LEAK ReDoS: repeated key prefixes stay fast', slow(() => SECRET_HIGH.forEach((p) => p.re.test(keyish))) < 500);

// ---------- الفشل المغلق: حارس انكسر أحد ملفاته يسأل ولا يسمح بصمت
const LOGIC = join(tmp, '.claude/hooks/lib/secret-guard.mjs');
const original = readFileSync(LOGIC, 'utf8');
try {
  writeFileSync(LOGIC, 'export const broken = {;\n');
  r = inClaude('Bash', { command: 'ls' });
  check('FAIL-CLOSED Claude Code: a syntax error in the guard → ask, naming the fix', says(r) === 'ask' && reason(r).includes('تعطّل'), r.out + r.err);
  // ملف الإقلاع لا يستورد شيئاً، فنص رسالته منسوخ في جسر OpenCode: يجب أن يبقى النصان واحداً
  check('FAIL-CLOSED: Claude Code and OpenCode show the same failure message', reason(r) === strongestDecision([HOOK_FAILED]).permissionDecisionReason);
  r = inCursor('Bash', { command: 'ls' });
  check('FAIL-CLOSED Cursor: a syntax error in the guard → deny', r.json?.permission === 'deny', r.out + r.err);
  writeFileSync(LOGIC, 'export async function runGuard() { throw new Error("boom"); }\n');
  r = inClaude('Read', { file_path: join(tmp, 'README.md') });
  check('FAIL-CLOSED Claude Code: an exception inside the guard → ask', says(r) === 'ask', r.out + r.err);
} finally {
  writeFileSync(LOGIC, original);
}
r = inClaude('Bash', { command: 'ls' });
check('FAIL-CLOSED: the repaired guard allows ordinary commands again', says(r) === 'allow' && r.code === 0, r.out + r.err);

check('FAIL-CLOSED OpenCode: a hook that could not run → HOOK_FAILED', await runHook('missing.mjs', {}, tmp) === HOOK_FAILED);
check('FAIL-CLOSED OpenCode: a failed guard counts as ask', strongestDecision([null, HOOK_FAILED])?.permissionDecision === 'ask');
check('FAIL-CLOSED OpenCode: deny still beats a failed guard', strongestDecision([HOOK_FAILED, { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'd' } }])?.permissionDecision === 'deny');

delete process.env.CLAUDE_PROJECT_DIR;
if (process.argv[1] === fileURLToPath(import.meta.url)) report();
