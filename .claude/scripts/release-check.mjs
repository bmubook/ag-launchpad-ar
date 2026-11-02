#!/usr/bin/env node
/**
 * فحص ما يصل الناس (launch-check): المفاتيح في ملفات البناء، ورؤوس الحماية في الموقع الحي، ووصول النشر.
 * الاستخدام:
 *   node .claude/scripts/release-check.mjs                      يفحص مجلدات البناء المعروفة (dist، build، ...)
 *   node .claude/scripts/release-check.mjs --dir <مجلد>          مجلد بناء محدد
 *   node .claude/scripts/release-check.mjs --url <رابط الموقع>   رؤوس الحماية في الموقع الحي
 *   node .claude/scripts/release-check.mjs --url <رابط> --expect <نص>   هل يحوي الموقع الحي النص (رقم الإصدار الجديد)؟
 *   --json لمخرج آلي. رمز الخروج 1 عند أي ❌.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILD_DIRS, checkDeployed, checkHeaders, checkTransport, scanBuild } from './lib/release-scan.mjs';

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ICON = { fail: '❌', warn: '⚠️', verify: '🔍 تحقق بنفسك', ok: '✅' };
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** يقرأ أول MAX_BODY_BYTES من الجسم ثم يقطع الاتصال، فلا تُحمَّل صفحة ضخمة كلها في الذاكرة. */
async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined); // الاتصال انتهى أصلاً: لا شيء يُلغى
  return Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8');
}

async function checkLive(url, expected) {
  if (!/^https?:\/\//i.test(url)) return [{ level: 'fail', title: 'رابط غير صالح', detail: `«${url}» يجب أن يبدأ بـ https://` }];
  let response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } });
  } catch (error) {
    return [{ level: 'fail', title: 'تعذّر الوصول إلى الموقع الحي', detail: `${url} — ${error?.cause?.code || error?.name || 'خطأ شبكة'}` }];
  }
  const final = response.url || url;
  const out = [...checkTransport(url, final), ...checkHeaders(response.headers, final)];
  if (!response.ok) out.unshift({ level: 'fail', title: `الموقع يرد بالرمز ${response.status}`, detail: url });
  try {
    if (expected) out.push(...checkDeployed(await readLimited(response), expected, url));
    else await response.body?.cancel();
  } catch (error) {
    out.push({ level: 'fail', title: 'انقطع الاتصال أثناء قراءة الموقع الحي', detail: `${url} — ${error?.name || 'خطأ شبكة'}` });
  }
  return out;
}

// اسم ملف مصنوع (فيه | أو سطر جديد) لا يكسر الجدول ولا يُدخل سطراً حراً إلى ما يقرؤه الوكيل
const cell = (text) => text.replace(/\r?\n|\r/g, ' ').replace(/\|/g, '\\|');

function toMarkdown(sections) {
  const lines = [];
  for (const [heading, items] of sections) {
    lines.push(`### ${heading}`, '', '| الحالة | البند | التفاصيل |', '| :---: | :--- | :--- |');
    for (const f of items) lines.push(`| ${ICON[f.level]} | ${cell(f.title)} | ${cell(f.detail)} |`);
    lines.push('');
  }
  return lines.join('\n');
}

const sections = [];
const dir = option('--dir');
const url = option('--url');
if (dir || !url) sections.push(['🔑 المفاتيح في ملفات البناء', scanBuild(root, dir ? [dir] : BUILD_DIRS, (file) => readFileSync(file, 'utf8'))]);
if (url) sections.push(['🌐 الموقع الحي', await checkLive(url, option('--expect'))]);

const failed = sections.some(([, items]) => items.some((f) => f.level === 'fail'));
process.stdout.write(args.includes('--json') ? JSON.stringify(Object.fromEntries(sections), null, 2) : toMarkdown(sections));
process.exitCode = failed ? 1 : 0;
