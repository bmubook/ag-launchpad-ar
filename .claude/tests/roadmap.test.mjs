// اختبارات خارطة الطريق (docs/roadmap.html): المحطات والخطوة التالية، قراءة المراحل والتدفقات، ما يُمنع تسريبه،
// الألوان، والتحديث التلقائي بعد التعديل. الفكرة من مشروع حقيقي بُني بالقالب (خارطة طريق لمجلس الإدارة).
// تُشغَّل ضمن hooks.test.mjs، أو وحدها: node .claude/tests/roadmap.test.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO, check, ctx, freshProject, report, runNode, tmp } from './helpers.mjs';

const { roadmapData } = await import(pathToFileURL(join(REPO, '.claude/scripts/roadmap/data.mjs')).href);
const { roadmapHtml, writeRoadmap } = await import(pathToFileURL(join(REPO, '.claude/scripts/roadmap/page.mjs')).href);
const write = (file, content) => { mkdirSync(dirname(join(tmp, file)), { recursive: true }); writeFileSync(join(tmp, file), content); };
const stationOf = (data) => data.stations.find((s) => s.status === 'current')?.id || 'none';
const LEAK = ['SECRET-TASK', 'SECRET-CONTRACT', 'SECRET-RISK'];

/** project_map.md بالأقسام التي تقرؤها الخارطة؛ flows صفوف فهرس التدفقات بصيغة القالب. */
function projectMap({ name = 'متجر راهو', color = 'أزرق ملكي #3b82f6', stack = 'Next.js', flows = [], active = 1 } = {}) {
  const phase = (n, title, pct, state) => `| ${n} | ${title} | SECRET-TASK ${n} | ${pct} | ${state} |`;
  return ['<div dir="rtl">', '', '## 1. بيانات المشروع الأساسية:', `* **اسم المشروع:** ${name}`, '* **وضع التشغيل النشط:** production', '',
    '## 4. تفضيلات التصميم (Design Preferences):', `* **اللون الرئيسي:** ${color}`, '',
    '## 5. التقنيات المعتمدة (Tech Stack):', '', '| الطبقة | التقنية المختارة | السبب |', '| :--- | :--- | :--- |', `| الواجهة الأمامية | ${stack} | — |`, '',
    '## 10. خطة التنفيذ المرحلية (Milestones):', '', `> ▶ **المرحلة النشطة حالياً:** المرحلة ${active}`, '',
    '| # | المرحلة | المهام الرئيسية | نسبة الإنجاز | الحالة |', '| :---: | :--- | :--- | :---: | :---: |',
    phase(1, 'التأسيس', '100%', '✅ مكتملة'), phase(2, 'الحسابات', '40%', '🟡 قيد التنفيذ'), phase(3, 'الطلبات', '150%', '⬜ لم تبدأ'), phase(4, 'الإطلاق', 'abc', '⬜ لم تبدأ'), '',
    '## 11. سجل المخاطر (Risk Register):', '', '| # | الخطر | الاحتمالية | التأثير | خطة التخفيف |', '| :---: | :--- | :---: | :---: | :--- |', '| 1 | SECRET-RISK | 🟢 | 🟢 | - |', '',
    '## 13. فهرس التدفقات (Flow Index):', '', '| # | التدفق | من يبدأ | النتيجة المحفوظة | من يحق له التغيير | ما يرفضه الاختبار | المرحلة | الاختبار | الحالة |',
    '| :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :---: |',
    ...(flows.length ? flows.map(([n, title, phaseNo, state]) => `| ${n} | ${title} | الزائر | SECRET-CONTRACT | المالك | محاولة غريب | ${phaseNo} | tests/x.test.ts | ${state} |`)
      : ['| - | لا توجد تدفقات بعد | - | - | - | - | - | - | - |']), '', '</div>'].join('\n');
}

// ---------- قبل الإقلاع: ملف تجربة لا project_map.md الحقيقي، فالاختبارات تُشغَّل أيضاً داخل مشاريع أُقلعت
freshProject();
write('project_map.md', projectMap({ name: '[يُملأ من المستخدم]', stack: '[لم يُحدد بعد]' }));
const template = roadmapData(tmp);
check('RM before kickoff: the journey points at kickoff, phases are tentative', stationOf(template) === 'kickoff'
  && template.tentative && template.next.command === '/kickoff' && template.phases.length > 0 && template.project === 'مشروعك', JSON.stringify(template.stations));

// ---------- محطات الرحلة كما تُحسب من ملفات المشروع
freshProject();
write('project_map.md', projectMap({ stack: '[لم يُحدد بعد]' }));
let data = roadmapData(tmp);
check('RM journey: kicked off, no flows yet → brainstorm is current, next /grill-me', stationOf(data) === 'brainstorm' && data.next.command === '/grill-me' && data.tentative);
write('project_map.md', projectMap({ stack: '[لم يُحدد بعد]', flows: [[1, 'إنشاء حساب', 2, '⬜ لم يبدأ']] }));
check('RM journey: flows written but no stack → blueprint is current', stationOf(roadmapData(tmp)) === 'blueprint');
write('project_map.md', projectMap({ flows: [[1, 'إنشاء حساب', 2, '🟡 قيد العمل'], [2, 'طلب منتج', 3, '⬜ لم يبدأ']] }));
check('RM journey: stack chosen, no project checks → quality is current, next /quality-setup', stationOf(roadmapData(tmp)) === 'quality' && roadmapData(tmp).next.command === '/quality-setup');
write('package.json', JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }));
data = roadmapData(tmp);
check('RM journey: checks exist → build is current, next /next', stationOf(data) === 'build' && data.next.command === '/next' && !data.tentative);
write('project_map.md', projectMap({ flows: [[1, 'إنشاء حساب', 2, '🔴 مكسور'], [2, 'طلب منتج', 3, '⬜ لم يبدأ']] }));
check('RM journey: a broken flow → next step is /fix naming it', roadmapData(tmp).next.command === '/fix' && roadmapData(tmp).next.text.includes('إنشاء حساب'));
write('project_map.md', projectMap({ flows: [[1, 'إنشاء حساب', 2, '🔒 مقفل'], [2, 'طلب منتج', 3, '🔒 مقفل']] }));
write('docs/launch-report.md', '# تقرير\n\nالحكم: 🔴 **غير جاهز**\n');
check('RM journey: all flows locked, launch report not ready → launch is current', stationOf(roadmapData(tmp)) === 'launch');
write('docs/launch-report.md', '# تقرير\n\nالحكم: 🟢 **جاهز للإطلاق**\n');
data = roadmapData(tmp);
check('RM journey: launch report ready → every station done', stationOf(data) === 'none' && data.stations.every((s) => s.status === 'done') && data.next.text.includes('اكتملت'));

// ---------- المراحل والتدفقات
write('project_map.md', projectMap({ active: 2, flows: [[1, 'إنشاء حساب', 2, '🔒 مقفل'], [2, 'طلب منتج', 3, '🟡 قيد العمل'], [3, 'دفع', '-', '⬜ لم يبدأ']] }));
data = roadmapData(tmp);
check('RM phases: names, statuses, and percentages clamped to 0–100', JSON.stringify(data.phases.map((p) => [p.name, p.percent, p.status]))
  === JSON.stringify([['التأسيس', 100, 'done'], ['الحسابات', 40, 'doing'], ['الطلبات', 100, 'upcoming'], ['الإطلاق', 0, 'upcoming']]), JSON.stringify(data.phases));
check('RM phases: active phase and overall average', data.activePhase === 2 && data.overall === 60, `${data.activePhase} ${data.overall}`);
check('RM flows: phase number and status per flow, unknown phase → null', JSON.stringify(data.flows.map((f) => [f.name, f.phase, f.status]))
  === JSON.stringify([['إنشاء حساب', 2, 'done'], ['طلب منتج', 3, 'doing'], ['دفع', null, 'upcoming']]), JSON.stringify(data.flows));
write('changelog.md', '| 2026-10-01 10:00 | v0.1.0 | chore |\n| 2026-10-05 09:30 | v0.2.0 | feat |\n');
check('RM updated: the date of the last changelog row', roadmapData(tmp).updatedAt === '2026-10-05');

// ---------- ما يُمنع تسريبه، والتهريب
let html = roadmapHtml(roadmapData(tmp));
check('RM safe: technical tasks, flow contracts, and risks never reach the page', LEAK.every((word) => !html.includes(word)), LEAK.find((w) => html.includes(w)));
check('RM page: every placeholder is filled', !/__[A-Z_]+__/.test(html), html.match(/__[A-Z_]+__/)?.[0]);
write('project_map.md', projectMap({ name: 'متجر</script><script>alert(1)</script>', flows: [[1, '</script><img src=x onerror=alert(1)>', 1, '🟡 قيد العمل']] }));
html = roadmapHtml(roadmapData(tmp));
const dataTag = html.match(/<script id="roadmap-data" type="application\/json">([\s\S]*?)<\/script>/);
check('RM escape: a name containing </script> cannot close the data tag', (html.match(/<\/script>/g) || []).length === 2
  && JSON.parse(dataTag[1]).flows[0].name.startsWith('</script>'), html.slice(html.indexOf('roadmap-data'), html.indexOf('roadmap-data') + 200));
check('RM escape: data is rendered with textContent, never innerHTML', !/innerHTML/.test(readFileSync(join(REPO, '.claude/scripts/roadmap/template.html'), 'utf8')));

// ---------- الألوان: لون المشروع، ونص مقروء فوقه، ولون بارز في الوضعين
const luminance = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const colorsOf = (color) => { write('project_map.md', projectMap({ color })); return roadmapData(tmp); };
let colors = colorsOf('أخضر داكن #0B3D2E');
check('RM colors: the project colour is used, white text on a dark colour', colors.brand === '#0b3d2e' && colors.brandInk === '#ffffff');
check('RM colors: a dark colour gets a lighter accent that stays visible in dark mode', contrast(colors.accentDark, '#0b1020') >= 3 && contrast(colors.accentLight, '#f6f7f9') >= 3, `${colors.accentLight} ${colors.accentDark}`);
colors = colorsOf('ذهبي #ffd700');
check('RM colors: a light colour gets dark text and a darker accent in light mode', colors.brandInk === '#111827' && contrast(colors.accentLight, '#f6f7f9') >= 3, colors.accentLight);
check('RM colors: short hex is expanded, a colour name without hex falls back to the default', colorsOf('#abc').brand === '#aabbcc' && colorsOf('أخضر').brand === '#4f46e5');

// ---------- الكتابة والتحديث التلقائي
freshProject({ kicked: true });
write('project_map.md', projectMap({ flows: [[1, 'إنشاء حساب', 2, '🟡 قيد العمل']] }));
const first = writeRoadmap(tmp);
const second = writeRoadmap(tmp);
check('RM write: created once, then rewritten only when something changed', first.created && !second.created && existsSync(join(tmp, 'docs/roadmap.html')));
rmSync(join(tmp, 'docs/roadmap.html'));
const post = () => runNode('.claude/hooks/post-edit.mjs', { session_id: 'rm', tool_name: 'Edit', tool_input: { file_path: join(tmp, 'project_map.md'), old_string: 'a', new_string: 'b' } });
let r = post();
check('RM hook: editing project_map.md creates the roadmap and asks the agent to tell the user', existsSync(join(tmp, 'docs/roadmap.html')) && ctx(r).includes('🗺️'), r.out + r.err);
write('project_map.md', projectMap({ flows: [[1, 'إنشاء حساب', 2, '🔒 مقفل']] }));
r = post();
check('RM hook: later edits refresh it silently', !ctx(r).includes('🗺️') && readFileSync(join(tmp, 'docs/roadmap.html'), 'utf8').includes('"status":"done"'), r.out);
freshProject();
r = runNode('.claude/hooks/post-edit.mjs', { session_id: 'rm2', tool_name: 'Edit', tool_input: { file_path: join(tmp, 'project_map.md'), old_string: 'a', new_string: 'b' } });
check('RM hook: before kickoff no roadmap is written', !existsSync(join(tmp, 'docs/roadmap.html')), r.out);
r = runNode('.claude/scripts/roadmap.mjs', '', { args: ['--dry-run-open'] });
check('RM cli: prints where the roadmap is and the next step, and can open it', r.code === 0 && r.out.includes('خارطة الطريق') && r.out.includes('/kickoff')
  && /roadmap\.html/.test(r.out.split('\n').pop() || r.out), r.out + r.err);

if (process.argv[1] === fileURLToPath(import.meta.url)) report();
