// اختبارات فحص ما يصل الناس (release-check.mjs): مفاتيح في ملفات البناء، ورؤوس الموقع الحي، ووصول النشر.
// تُشغَّل ضمن hooks.test.mjs، أو وحدها: node .claude/tests/release.test.mjs
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO, check, report } from './helpers.mjs';

const SCRIPT = join(REPO, '.claude/scripts/release-check.mjs');
const { checkHeaders, checkTransport, scanText } = await import(pathToFileURL(join(REPO, '.claude/scripts/lib/release-scan.mjs')).href);
const levels = (items) => items.map((f) => f.level);

// قيم بالشكل الصحيح تُركَّب من أجزاء حتى لا يوقف الحارس كتابة هذا الملف نفسه
const jwt = (role) => ['{"alg":"HS256"}', JSON.stringify({ iss: 'supabase', role })].map((s) => Buffer.from(s).toString('base64url')).join('.') + '.' + 'Sig0'.repeat(8);
const FAKE = {
  groq: 'gsk' + '_' + 'Ab12'.repeat(13),
  google: 'AI' + 'zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
  serviceRole: jwt('service' + '_role'),
  anon: jwt('anon'),
  dbUrl: 'postgres' + '://admin:' + 'Zq81mPw9Lk' + '@db.prod-host.com:5432/app',
};

const projects = [];
// يُحذف حتى لو فشل اختبار أو رُمي استثناء في منتصف الملف
process.once('exit', () => projects.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aglp-release-'));
  projects.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}
const run = (dir, args = []) => new Promise((done) => {
  execFile('node', [SCRIPT, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, timeout: 60000 }, (error, out, err) => {
    done({ code: error ? error.code : 0, out, err });
  });
});

// ---------- المفاتيح في ملفات البناء
let r = await run(project({ 'dist/assets/app.js': 'const api = "/api/v1"; fetch(api);', 'dist/index.html': '<html></html>' }));
check('RELEASE: a clean build → ✅ and exit 0', r.code === 0 && r.out.includes('✅') && !r.out.includes('❌'), r.out + r.err);

r = await run(project({ 'dist/assets/app.js': `const groq="${FAKE.groq}";` }));
check('RELEASE: a Groq key in the bundle → ❌ and exit 1', r.code === 1 && r.out.includes('❌') && r.out.includes('Groq'), r.out + r.err);
check('RELEASE: the report never prints the full key', !r.out.includes(FAKE.groq) && r.out.includes('gsk_Ab…'), r.out);

r = await run(project({ 'build/web/main.dart.js': `firebaseConfig={apiKey:"${FAKE.google}"}` }));
check('RELEASE: a Firebase key in a Flutter web build → 🔍 verify, not ❌', r.code === 0 && r.out.includes('🔍') && !r.out.includes('❌'), r.out + r.err);

r = await run(project({ 'dist/app.js': `createClient(url,"${FAKE.serviceRole}")` }));
check('RELEASE: a Supabase service_role key in the bundle → ❌', r.code === 1 && r.out.includes('service_role'), r.out + r.err);
r = await run(project({ 'dist/app.js': `createClient(url,"${FAKE.anon}")` }));
check('RELEASE: LEGIT the public anon key → no ❌', r.code === 0 && !r.out.includes('❌'), r.out + r.err);

r = await run(project({ '.next/static/chunks/db.js': `const u="${FAKE.dbUrl}"` }));
check('RELEASE: a database URL with a password in .next/static → ❌', r.code === 1 && r.out.includes('قاعدة بيانات'), r.out + r.err);

r = await run(project({ 'dist/cfg.js': 'const u="postgres' + '://admin:hunt3r@db.prod-host.com/app"' }));
check('RELEASE: a short database password is never printed, only its length', r.code === 1 && !r.out.includes('hunt3r') && r.out.includes('6 حرفاً'), r.out);
r = await run(project({ 'dist/app.wasm': 'binary', 'dist/app.js.gz': 'zip', 'dist/app.js': 'ok' }));
check('RELEASE: binary and compressed files are listed as not scanned → ⚠️, never a silent ✅', r.code === 0 && r.out.includes('2 ملف لم يُفحص') && r.out.includes('app.wasm'), r.out + r.err);
r = await run(project({ 'dist/_headers': `X-Key: ${FAKE.groq}` }));
check('RELEASE: files without an extension (_headers) are scanned', r.code === 1 && r.out.includes('dist/_headers'), r.out + r.err);
r = await run(project({ 'dist/.env.sample': 'A=', 'dist/app.js': 'ok' }));
check('RELEASE: LEGIT a .env.sample inside the build → no ❌', r.code === 0 && !r.out.includes('❌'), r.out + r.err);
r = await run(project({ ['dist/.env' + 'ironment.js']: 'x', ['dist/.env' + '-config.js']: 'y' }));
check('RELEASE: LEGIT names that only start with .env (.environment.js) → no ❌', r.code === 0 && !r.out.includes('❌'), r.out + r.err);
r = await run(project({ 'dist/app.js': 'x', 'dist/app.js.map': '{"version":3}' }));
check('RELEASE: source maps in the build → ⚠️, not ❌', r.code === 0 && r.out.includes('.map') && r.out.includes('⚠️'), r.out + r.err);
r = await run(project({ 'dist/.env.production': 'A=1', 'dist/.env.example': 'A=' }));
check('RELEASE: a .env file inside the build → ❌ (not its .example)', r.code === 1 && r.out.includes('.env.production') && !r.out.includes('.env.example`'), r.out + r.err);

r = await run(project({ 'src/app.js': 'x' }));
check('RELEASE: no build folder → ⚠️ asking to build first', r.code === 0 && r.out.includes('لا يوجد مجلد بناء'), r.out + r.err);
r = await run(project({ 'public_html/app.js': `k="${FAKE.groq}"` }), ['--dir', 'public_html']);
check('RELEASE: --dir scans a custom build folder', r.code === 1 && r.out.includes('public_html/app.js'), r.out + r.err);
r = await run(project({ 'dist/app.js': `k="${FAKE.groq}"` }), ['--json']);
let parsed = null; try { parsed = JSON.parse(r.out); } catch { /* يفشل الاختبار أدناه */ }
check('RELEASE: --json prints machine output', r.code === 1 && Array.isArray(Object.values(parsed || {})[0]), r.out);

// ---------- الموقع الحي: خادم محلي بلا رؤوس، وآخر برؤوس كاملة
const SAFE_HEADERS = {
  'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
};
const server = createServer((req, res) => {
  if (req.url === '/broken') { res.writeHead(500); res.end('down'); return; }
  res.writeHead(200, { 'content-type': 'text/html', ...(req.url === '/safe' ? SAFE_HEADERS : {}) });
  res.end('<html><meta name="version" content="1.4.0"></html>');
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const empty = project({});
try {
  r = await run(empty, ['--url', `${base}/plain`]);
  check('LIVE: missing security headers and no HTTPS → ⚠️ for each, exit 0', r.code === 0 && (r.out.match(/⚠️/g) || []).length === 5 && r.out.includes('HTTPS') && !r.out.includes('🔑'), r.out + r.err);
  r = await run(empty, ['--url', `${base}/safe`]);
  check('LIVE: all headers present → ✅ (HSTS not required on http)', r.code === 0 && r.out.includes('رؤوس الحماية موجودة'), r.out + r.err);
  r = await run(empty, ['--url', `${base}/safe`, '--expect', '1.4.0']);
  check('LIVE: the live page has the new version → ✅ deployed', r.code === 0 && r.out.includes('النسخة الجديدة منشورة'), r.out + r.err);
  r = await run(empty, ['--url', `${base}/safe`, '--expect', '1.5.0']);
  check('LIVE: the live page still has the old version → ❌ and exit 1', r.code === 1 && r.out.includes('النشر لم يصل'), r.out + r.err);
  r = await run(empty, ['--url', `${base}/broken`]);
  check('LIVE: the site answers 500 → ❌', r.code === 1 && r.out.includes('500'), r.out + r.err);
} finally {
  await new Promise((ok) => server.close(ok));
}
// منفذ كان لخادم أُغلق للتو وانتُظر إغلاقه
const closed = createServer();
await new Promise((ok) => closed.listen(0, '127.0.0.1', ok));
const closedUrl = `http://127.0.0.1:${closed.address().port}`;
await new Promise((ok) => closed.close(ok));
r = await run(empty, ['--url', closedUrl]);
check('LIVE: an unreachable site → ❌ with the reason', r.code === 1 && r.out.includes('تعذّر الوصول'), r.out + r.err);
r = await run(empty, ['--url', 'file:///etc/passwd']);
check('LIVE: only http(s) links are fetched', r.code === 1 && r.out.includes('رابط غير صالح'), r.out + r.err);

// ---------- وحدات صغيرة
const headers = (map) => ({ get: (name) => map[name] ?? null });
check('HEADERS: https without HSTS → ⚠️', levels(checkHeaders(headers(SAFE_HEADERS), 'https://x.com')).join() === 'warn');
check('HEADERS: X-Frame-Options alone protects from framing', !checkHeaders(headers({ ...SAFE_HEADERS, 'content-security-policy': "default-src 'self'", 'x-frame-options': 'DENY' }), 'http://x').some((f) => f.title.includes('إطار')));
check('HTTPS: https redirected to http → ❌', levels(checkTransport('https://x.com', 'http://x.com/')).join() === 'fail');
check('HTTPS: an http site that never moves to https → ⚠️', levels(checkTransport('http://x.com', 'http://x.com/')).join() === 'warn');
check('HTTPS: capital HTTPS:// redirected to http → ❌ too', levels(checkTransport('HTTPS://x.com', 'http://x.com/')).join() === 'fail');
check('HTTPS: http redirected to https → nothing to report', checkTransport('http://x.com', 'https://x.com/').length === 0);
check('SCAN: a placeholder password is not reported', scanText('password: "your-password-here"', 'a.js').length === 0);
check('SCAN: a broken JWT does not crash the scan', Array.isArray(scanText('eyJ' + 'a'.repeat(12) + '.eyJ' + '%'.repeat(12) + '.' + 'b'.repeat(12), 'a.js')));

if (process.argv[1] === fileURLToPath(import.meta.url)) report();
