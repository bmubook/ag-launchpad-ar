/* منطق معالج الإقلاع: التنقل بين الخطوات، التحقق، الحفظ التلقائي، المراجعة، التوليد، والوضع الفاتح/الداكن. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('wizardForm');
  const DRAFT_KEY = 'ag-launchpad-ar.draft';
  const FIELDS = ['env', 'name', 'type', 'idea', 'audience', 'style', 'colorMode', 'color', 'level', 'mode', 'callSign'];

  const STEPS = [
    { id: 'env', title: 'بيئة العمل', required: ['env'] },
    { id: 'project', title: 'المشروع', required: ['name', 'type', 'idea'] },
    { id: 'design', title: 'التصميم', required: [], when: (d) => d.type !== 'backend' },
    { id: 'work', title: 'طريقة العمل', required: ['level', 'mode', 'callSign'] },
    { id: 'review', title: 'المراجعة', required: [] },
  ];
  const LABELS = {
    env: { claude: 'Claude Code', antigravity: 'Google Antigravity' },
    type: { web: '🌐 تطبيق ويب', flutter: '📱 جوال — Flutter', rn: '📱 جوال — React Native', backend: '⚙️ باك إند فقط' },
    mode: { prototype: '🧪 تجربة سريعة (prototype)', production: '🏭 منتج حقيقي (production)' },
  };

  let current = 0;

  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* التخزين غير متاح — الصفحة تعمل بدونه */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* تجاهل */ } },
  };

  function data() {
    const values = {};
    for (const name of FIELDS) {
      const el = form.elements[name];
      values[name] = el ? String(el.value || '').trim() : '';
    }
    return values;
  }

  const activeSteps = () => { const d = data(); return STEPS.filter((s) => !s.when || s.when(d)); };

  function renderProgress(steps) {
    $('stepNow').textContent = String(current + 1);
    $('stepTotal').textContent = String(steps.length);
    $('stepName').textContent = steps[current].title;
    $('progressFill').style.inlineSize = `${((current + 1) / steps.length) * 100}%`;
    const list = $('progressSteps');
    list.replaceChildren(...steps.map((s, i) => {
      const li = document.createElement('li');
      li.textContent = s.title;
      if (i < current) li.className = 'done';
      if (i === current) li.setAttribute('aria-current', 'step');
      return li;
    }));
  }

  function showStep(index, { focus = true } = {}) {
    const steps = activeSteps();
    current = Math.max(0, Math.min(index, steps.length - 1));
    const step = steps[current];
    document.querySelectorAll('.step').forEach((el) => { el.hidden = el.dataset.step !== step.id; });
    $('btnBack').hidden = current === 0;
    $('btnNext').textContent = step.id === 'review' ? '⚡ توليد نص البداية' : 'التالي ←';
    if (step.id === 'review') renderReview();
    renderProgress(steps);
    saveDraft();
    if (focus) $(`h-${step.id}`).focus();
  }

  function setInvalid(name, invalid) {
    const wrapper = form.querySelector(`[data-field="${name}"]`);
    if (!wrapper) return;
    wrapper.classList.toggle('invalid', invalid);
    wrapper.querySelectorAll('input, textarea').forEach((el) => el.setAttribute('aria-invalid', String(invalid)));
  }

  function validate(step) {
    const d = data();
    const missing = step.required.filter((name) => !d[name]);
    step.required.forEach((name) => setInvalid(name, missing.includes(name)));
    if (missing.length) {
      const first = form.querySelector(`[data-field="${missing[0]}"] input, [data-field="${missing[0]}"] textarea`);
      if (first) first.focus();
    }
    return missing.length === 0;
  }

  function renderReview() {
    const d = data();
    const goTo = (stepId) => () => showStep(activeSteps().findIndex((s) => s.id === stepId));
    const reviewGroup = (title, stepId, rows) => window.AGLUI.reviewGroup(title, rows, goTo(stepId));
    const auto = 'سيختاره الوكيل';
    const groups = [
      reviewGroup('بيئة العمل', 'env', [['الأداة', LABELS.env[d.env] || '—']]),
      reviewGroup('المشروع', 'project', [['الاسم', d.name], ['النوع', LABELS.type[d.type] || '—'], ['الفكرة', d.idea]]),
    ];
    if (d.type !== 'backend') {
      groups.push(reviewGroup('التصميم', 'design', [
        ['المستخدم', d.audience || auto], ['الطابع', d.style ? d.style.split(' — ')[0] : auto],
        ['الوضع البصري', d.colorMode || auto], ['اللون', d.color || auto],
      ]));
    }
    groups.push(reviewGroup('طريقة العمل', 'work', [['الخبرة', d.level], ['الهدف', LABELS.mode[d.mode] || '—'], ['اسم النداء', d.callSign]]));
    $('reviewList').replaceChildren(...groups);
  }

  function generate() {
    const d = data();
    const isClaude = d.env === 'claude';
    $('output').textContent = isClaude ? window.AGL.claude(d) : window.AGL.antigravity(d);
    $('resultLead').textContent = isClaude
      ? 'انسخه والصقه في Claude Code داخل جذر مجلد المشروع. إذا لم يبدأ الإقلاع تلقائياً فاكتب ⁦/kickoff⁩ ثم الصق النص.'
      : 'انسخه وأرسله للوكيل في محادثة جديدة داخل Antigravity.';
    $('nextSteps').innerHTML = window.AGL.NEXT_STEPS[d.env].map((s) => `<li>${s}</li>`).join('');
    form.hidden = true;
    document.querySelector('.progress').hidden = true;
    $('result').hidden = false;
    $('h-result').focus();
  }

  function saveDraft() {
    storage.set(DRAFT_KEY, JSON.stringify({ values: data(), step: activeSteps()[current].id }));
  }

  function restoreDraft() {
    let draft = null;
    try { draft = JSON.parse(storage.get(DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
    if (!draft || !draft.values) return 0;
    for (const [name, value] of Object.entries(draft.values)) {
      const el = form.elements[name];
      if (!el || !value) continue;
      if (el instanceof RadioNodeList) {
        const radio = [...el].find((r) => r.value === value);
        if (radio) radio.checked = true;
      } else {
        el.value = value;
      }
    }
    return Math.max(0, activeSteps().findIndex((s) => s.id === draft.step));
  }

  function resetAll() {
    if (!window.confirm('هل تريد مسح كل الإجابات والبدء من جديد؟')) return;
    storage.remove(DRAFT_KEY);
    form.reset();
    FIELDS.forEach((name) => setInvalid(name, false));
    form.hidden = false;
    document.querySelector('.progress').hidden = false;
    $('result').hidden = true;
    showStep(0);
  }

  // ── الأحداث ──
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const step = activeSteps()[current];
    if (step.id === 'review') { generate(); return; }
    if (validate(step)) showStep(current + 1);
  });
  $('btnBack').addEventListener('click', () => showStep(current - 1));
  form.addEventListener('input', (event) => { if (event.target.name) setInvalid(event.target.name, false); saveDraft(); });
  form.addEventListener('change', (event) => {
    if (event.target.name) setInvalid(event.target.name, false);
    if (event.target.name === 'type') renderProgress(activeSteps());
    saveDraft();
  });
  document.querySelectorAll('.chip[data-fill]').forEach((chip) => chip.addEventListener('click', () => {
    const input = $(chip.dataset.fill);
    input.value = chip.dataset.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  $('btnCopy').addEventListener('click', () => window.AGLUI.copyText($('output'), $('btnCopy')));
  $('btnEdit').addEventListener('click', () => {
    $('result').hidden = true;
    form.hidden = false;
    document.querySelector('.progress').hidden = false;
    showStep(activeSteps().length - 1);
  });
  $('btnReset').addEventListener('click', resetAll);

  showStep(restoreDraft(), { focus: false });
})();
