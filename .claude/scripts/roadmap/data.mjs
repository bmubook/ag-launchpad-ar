/**
 * بيانات خارطة الطريق (docs/roadmap.html) من ملفات المشروع. الفكرة من مشروع حقيقي بُني بالقالب:
 * صفحة يرى منها صاحب المشروع أين وصل. تمرّ فقط البيانات الصالحة للعرض والمشاركة: أسماء المراحل ونسبها وحالاتها،
 * وأسماء التدفقات وحالاتها، ومحطة الرحلة الحالية. لا تمرّ المهام التقنية ولا المخاطر ولا عقود التدفقات.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectChecks } from '../../hooks/lib/checks.mjs';

const DEFAULT_BRAND = '#4f46e5';
const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i;

/** محطات رحلة القالب بترتيبها؛ done تُحسب من ملفات المشروع لا من ذاكرة الوكيل. */
const STATIONS = [
  { id: 'kickoff', name: 'الإقلاع', desc: 'تسجيل فكرتك وبيانات مشروعك وفحص جهازك.', command: '/kickoff' },
  { id: 'brainstorm', name: 'العصف الذهني', desc: 'تحويل الفكرة إلى ميزات النسخة الأولى.', command: '/grill-me' },
  { id: 'blueprint', name: 'المخطط التقني', desc: 'اختيار تقنيات مجرّبة تناسب نوع مشروعك.', command: '/blueprint' },
  { id: 'quality', name: 'أساس الجودة', desc: 'أدوات الفحص وأول اختبار قبل أول ميزة.', command: '/quality-setup' },
  { id: 'build', name: 'البناء', desc: 'بناء الميزات واحدة واحدة، وكل ميزة تُقفل حين ينجح اختبارها.', command: '/next' },
  { id: 'launch', name: 'الإطلاق', desc: 'فحص شامل قبل أن يستخدم الناس تطبيقك.', command: '/launch-check' },
];

const read = (root, file) => {
  try {
    return readFileSync(join(root, file), 'utf8');
  } catch {
    return '';
  }
};

/** أسطر القسم «## N.» حتى القسم التالي. */
function sectionLines(markdown, number) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${number}.`));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && /^## \d+\./.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const numberedRows = (lines) => lines.filter((line) => /^\|\s*\d+\s*\|/.test(line)).map(cellsOf);

function anchor(markdown, label) {
  const match = markdown.match(new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*(.*)`));
  const value = (match?.[1] || '').trim();
  return !value || value.startsWith('[') ? null : value;
}

const phaseStatus = (cell) => (cell.includes('✅') ? 'done' : cell.includes('🟡') ? 'doing' : 'upcoming');

function flowStatus(cell) {
  if (cell.includes('🔒')) return 'done';
  if (cell.includes('🟡')) return 'doing';
  if (cell.includes('🔴')) return 'broken';
  return 'upcoming';
}

function phases(map) {
  return numberedRows(sectionLines(map, 10)).map((cells) => ({
    number: Number(cells[0]),
    name: cells[1] || `المرحلة ${cells[0]}`,
    percent: Math.min(100, Math.max(0, parseInt(cells[3], 10) || 0)),
    status: phaseStatus(cells[4] || ''),
  }));
}

function flows(map) {
  return numberedRows(sectionLines(map, 13)).map((cells) => {
    const phase = parseInt(cells[6], 10);
    return { number: Number(cells[0]), name: cells[1], phase: Number.isFinite(phase) ? phase : null, status: flowStatus(cells[cells.length - 1] || '') };
  });
}

/** هل اختيرت التقنيات؟ صف واحد على الأقل في جدول القسم 5 بقيمة حقيقية لا «[لم يُحدد بعد]». */
function stackChosen(map) {
  const rows = sectionLines(map, 5).filter((line) => line.trim().startsWith('|') && !/:-{3}/.test(line)).slice(1).map(cellsOf);
  return rows.some((cells) => cells[1] && !cells[1].startsWith('['));
}

/** حكم تقرير /launch-check: 🟢 جاهز أو 🟡 جاهز بملاحظات = مكتمل؛ 🔴 أو لا تقرير = لم يكتمل. */
const launchReady = (report) => /(🟢|🟡)\s*\*{0,2}جاهز/.test(report);

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** أقرب درجة من اللون نحو target (أسود أو أبيض) يبلغ تباينها مع الخلفية 3:1، كي تبقى الإطارات والأشرطة ظاهرة. */
function accentOn(brand, background, target) {
  for (let step = 0; step <= 10; step += 1) {
    const color = toHex(channels(brand).map((c, i) => c + (channels(target)[i] - c) * (step / 10)));
    if (contrast(color, background) >= 3) return color;
  }
  return target;
}

/** لون المشروع من «اللون الرئيسي» في القسم 4، ولون النص فوقه، ولون بارز لكل من الوضعين الفاتح والداكن. */
function brandColors(map) {
  const brand = (anchor(map, 'اللون الرئيسي') || '').match(HEX)?.[0] || DEFAULT_BRAND;
  const full = (brand.length === 4 ? `#${[...brand.slice(1)].map((c) => c + c).join('')}` : brand).toLowerCase();
  const inkOn = (color) => (contrast(color, '#ffffff') >= 4.5 ? '#ffffff' : '#111827');
  const accentLight = accentOn(full, '#f6f7f9', '#000000');
  const accentDark = accentOn(full, '#0b1020', '#ffffff');
  return {
    brand: full, brandInk: inkOn(full),
    accentLight, accentDark, accentInkLight: inkOn(accentLight), accentInkDark: inkOn(accentDark),
  };
}

function lastChangeDate(changelog) {
  const dates = [...changelog.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})[\s\d:]*\|/gm)].map((match) => match[1]);
  return dates.length ? dates[dates.length - 1] : null;
}

function journey(map, flowList, root) {
  const done = {
    kickoff: Boolean(anchor(map, 'اسم المشروع')),
    brainstorm: flowList.length > 0,
    blueprint: stackChosen(map),
    quality: detectChecks(root).length > 0,
    build: flowList.length > 0 && flowList.every((flow) => flow.status === 'done'),
    launch: launchReady(read(root, 'docs/launch-report.md')),
  };
  const current = STATIONS.find((station) => !done[station.id])?.id || null;
  return STATIONS.map((station) => ({ ...station, status: done[station.id] ? 'done' : station.id === current ? 'current' : 'upcoming' }));
}

function nextStep(stations, flowList) {
  const current = stations.find((station) => station.status === 'current');
  if (!current) return { command: '/next', text: 'اكتملت الرحلة. اطلب من الوكيل ما تريد تطويره بعد ذلك.' };
  const broken = current.id === 'build' && flowList.find((flow) => flow.status === 'broken');
  if (broken) return { command: '/fix', text: `أصلح ميزة «${broken.name}» قبل أي ميزة أخرى.` };
  return { command: current.command, text: current.desc };
}

/** كل ما تعرضه الخارطة، من جذر المشروع root. */
export function roadmapData(root) {
  const map = read(root, 'project_map.md');
  const phaseList = phases(map);
  const flowList = flows(map);
  const stations = journey(map, flowList, root);
  return {
    project: anchor(map, 'اسم المشروع') || 'مشروعك',
    activePhase: Number((map.match(/المرحلة النشطة حالياً:\*\*\s*المرحلة\s*(\d+)/) || [])[1]) || null,
    tentative: !stations.find((station) => station.id === 'brainstorm' && station.status === 'done'),
    overall: phaseList.length ? Math.round(phaseList.reduce((sum, phase) => sum + phase.percent, 0) / phaseList.length) : 0,
    phases: phaseList,
    flows: flowList,
    stations,
    next: nextStep(stations, flowList),
    updatedAt: lastChangeDate(read(root, 'changelog.md')),
    ...brandColors(map),
  };
}
