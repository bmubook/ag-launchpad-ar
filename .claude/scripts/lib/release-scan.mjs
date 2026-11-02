/**
 * فحص ما يصل الناس فعلاً (launch-check): الملفات المبنية التي تُرفع للاستضافة، ورؤوس الموقع الحي.
 * درس من مشاريع حقيقية: مفاتيح وكلمات مرور لم تكن في المستودع ظهرت في الحزمة المنشورة (docs/research-lessons-2026-11.md §د).
 * النتيجة: { level: 'fail' | 'warn' | 'verify' | 'ok', title, detail } — ولا تُطبع قيمة سر أبداً، بل اسمه وموضعه.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ENV_GLOB, SECRET_HIGH, SECRET_MEDIUM } from '../../hooks/lib/patterns.mjs';

export const BUILD_DIRS = ['dist', 'build', 'out', '.next/static', '.output/public', 'web-build', 'www'];
// ملفات بلا امتداد مثل _headers و _redirects و .htaccess، وملفات .env.*، نصية أيضاً
const TEXT_FILE = /(?:\.(?:m?js|cjs|html?|css|json|txt|map|xml|webmanifest|svg|ya?ml|ini|conf|toml|php|htaccess)|(?:^|\/)(?:[^./]+|\.env[^/]*))$/i;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20000;
// ENV_GLOB يطابق بادئة الاسم (.environment.js أيضاً)؛ هنا الاسم كله ملف بيئة: .env أو .env.<شيء>
const ENV_NAME = /(?:^|\/)\.env(?:\.[^/]*)?$/i;

const finding = (level, title, detail) => ({ level, title, detail });
const toPosix = (p) => p.replace(/\\/g, '/');
const medium = (name) => SECRET_MEDIUM.find((p) => p.name === name);
const JWT = new RegExp(medium('JWT / service key').re.source, 'g');
// كلمة مرور ملتقطة تُعرض بطولها فقط: أول أحرفها قد تكون معظمها
const CAPTURED = [
  { rule: medium('database URL with password'), level: 'fail', note: 'رابط قاعدة بيانات بكلمة مرور' },
  { rule: medium('hard-coded credential'), level: 'verify', note: 'قيمة بجوار كلمة سر أو مفتاح' },
];

/** بادئة المزوّد فقط (gsk_، ‏eyJ...) ليعرف المستخدم أي مفتاح هو دون نسخ قيمته. */
export const mask = (value) => `${value.slice(0, 6)}… (${value.length} حرفاً)`;
const lengthOnly = (value) => `*** (${value.length} حرفاً)`;

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null; // ليس JWT صالحاً: لا دور يُقرأ منه
  }
}

/** يفحص نص ملف مبني واحد. file للعرض فقط. */
export function scanText(text, file) {
  const out = [];
  for (const { name, re, publicInFirebaseConfig } of SECRET_HIGH) {
    const match = text.match(re);
    if (!match) continue;
    out.push(publicInFirebaseConfig
      ? finding('verify', `مفتاح Google في \`${file}\``, `${mask(match[0])} — عام بطبيعته في إعدادات Firebase؛ تأكد أنه مقيّد بنطاقك وتطبيقك في Google Cloud`)
      : finding('fail', `${name} في \`${file}\``, `${mask(match[0])} — أي زائر يقرؤه. ألغِه من لوحة المزوّد فوراً وانقل النداء إلى الخادم`));
  }
  for (const [token] of text.matchAll(JWT)) {
    if (jwtRole(token) !== 'service_role') continue; // مفتاح anon عام بطبيعته
    out.push(finding('fail', `مفتاح service_role لـ Supabase في \`${file}\``, `${mask(token)} — يتخطى كل سياسات RLS. ألغِه فوراً`));
    break;
  }
  for (const { rule, level, note } of CAPTURED) {
    for (const hit of text.matchAll(rule.re)) {
      if (rule.accept && !rule.accept(hit)) continue;
      out.push(finding(level, `${note} في \`${file}\``, `${lengthOnly(hit[1] || hit[0])} — افتح الملف وتأكد أنها ليست سراً حقيقياً`));
      break;
    }
  }
  return out;
}

function* walk(dir, state) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    state.unreadable.push(`${toPosix(relative(state.root, dir))} (${error.code || 'خطأ'})`);
    return;
  }
  for (const entry of entries) {
    if (state.left <= 0) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, state);
    else if (entry.isFile()) { state.left -= 1; yield full; }
    else if (entry.isSymbolicLink()) state.skipped.push(toPosix(relative(state.root, full)));
  }
}

const listSome = (files) => files.slice(0, 5).map((f) => `\`${f}\``).join('، ') + (files.length > 5 ? ` و${files.length - 5} غيرها` : '');

/** يفحص مجلدات البناء الموجودة (أو dirs المحددة) ويعيد النتائج. read(full) يعيد نص الملف. */
export function scanBuild(root, dirs = BUILD_DIRS, read) {
  const present = dirs.filter((d) => existsSync(join(root, d)) && statSync(join(root, d)).isDirectory());
  if (!present.length) {
    return [finding('warn', 'لا يوجد مجلد بناء', `شغّل أمر البناء أولاً، أو حدّد المجلد بـ --dir (بحثت في: ${dirs.join('، ')})`)];
  }
  const out = [];
  const state = { root, left: MAX_FILES, skipped: [], unreadable: [] };
  let scanned = 0;
  let maps = 0;
  for (const dir of present) {
    for (const full of walk(join(root, dir), state)) {
      const rel = toPosix(relative(root, full));
      if (ENV_GLOB.test(rel) && ENV_NAME.test(rel)) out.push(finding('fail', `ملف بيئة داخل البناء: \`${rel}\``, 'سيُرفع للاستضافة ويُقرأ من المتصفح. احذفه من البناء وأضفه لقائمة الاستبعاد'));
      if (!TEXT_FILE.test(rel) || statSync(full).size > MAX_FILE_BYTES) { state.skipped.push(rel); continue; }
      if (rel.endsWith('.map')) maps += 1;
      scanned += 1;
      out.push(...scanText(read(full), rel));
    }
  }
  const { skipped } = state;
  if (skipped.length) out.push(finding('warn', `${skipped.length} ملف لم يُفحص`, `ثنائي أو مضغوط أو رابط رمزي أو أكبر من 20MB: ${listSome(skipped)}. افحصه بنفسك إن كان قد يحوي إعدادات`));
  if (state.unreadable.length) out.push(finding('warn', 'مجلد تعذّرت قراءته', listSome(state.unreadable)));
  if (maps) out.push(finding('warn', `${maps} ملف خرائط مصدر (.map) في البناء`, 'تكشف كودك الأصلي لمن يفتحها؛ عطّلها في إعداد البناء للإنتاج أو لا ترفعها'));
  if (state.left <= 0) out.push(finding('warn', 'البناء أكبر من حد الفحص', `فُحص أول ${MAX_FILES} ملف فقط؛ حدّد مجلداً أضيق بـ --dir`));
  if (!out.some((f) => f.level === 'fail' || f.level === 'verify')) out.push(finding('ok', 'لا مفاتيح في الملفات المفحوصة', `فُحص ${scanned} ملفاً في: ${present.join('، ')}`));
  return out;
}

const HEADERS = [
  ['strict-transport-security', 'HSTS: يُلزم المتصفح بـ HTTPS دائماً', (v, https) => !https || Boolean(v)],
  ['content-security-policy', 'CSP: يحدّ من حقن السكربتات (XSS)', (v) => Boolean(v)],
  ['x-content-type-options', 'nosniff: يمنع تخمين نوع الملف', (v) => /nosniff/i.test(v || '')],
  ['referrer-policy', 'Referrer-Policy: لا يُرسل الرابط الكامل لمواقع أخرى', (v) => Boolean(v)],
];

/** يفحص رؤوس الحماية في استجابة الموقع الحي. headers كائن Headers أو ما يشبهه (get). */
export function checkHeaders(headers, url) {
  const https = url.startsWith('https:');
  const out = [];
  for (const [name, why, ok] of HEADERS) {
    if (!ok(headers.get(name), https)) out.push(finding('warn', `رأس \`${name}\` غائب`, `${why}. يُضاف من إعدادات الاستضافة (firebase.json أو vercel.json أو _headers)`));
  }
  const framed = headers.get('x-frame-options') || /frame-ancestors/i.test(headers.get('content-security-policy') || '');
  if (!framed) out.push(finding('warn', 'لا حماية من تضمين الموقع في إطار', 'أضف `X-Frame-Options: DENY` أو `frame-ancestors` في CSP (حماية من خداع النقر)'));
  if (!out.length) out.push(finding('ok', 'رؤوس الحماية موجودة', url));
  return out;
}

/** HTTPS: رابط https يُحوَّل إلى http خفضٌ للحماية، ورابط http لا يُحوَّل إلى https يبقى مكشوفاً. */
export function checkTransport(requested, final) {
  const scheme = (url) => url.slice(0, url.indexOf(':') + 1).toLowerCase();
  if (scheme(requested) === 'https:' && scheme(final) === 'http:') return [finding('fail', 'الموقع يحوّل من HTTPS إلى HTTP', `${requested} ← ${final}`)];
  if (scheme(final) === 'http:') return [finding('warn', 'الموقع لا يحوّل إلى HTTPS', `${final} — فعّل التحويل الإجباري إلى https في الاستضافة`)];
  return [];
}

/** هل وصل النشر؟ النجاح أن يحوي الموقع الحي النص المتوقع (رقم الإصدار مثلاً)، لا رسالة نجاح أداة النشر. */
export function checkDeployed(body, expected, url) {
  return body.includes(expected)
    ? [finding('ok', 'النسخة الجديدة منشورة', `الموقع الحي يحوي «${expected}»`)]
    : [finding('fail', 'النشر لم يصل للموقع الحي', `${url} لا يحوي «${expected}». تحقق من سجل النشر (قد يكون «Skipped») ومن الكاش`)];
}
