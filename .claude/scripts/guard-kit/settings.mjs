/**
 * دمج إعدادات حقيبة الحارس في .claude/settings.json لمشروع قائم، وإزالتها منه.
 * المصدر إعداد القالب نفسه: كل Hook فيه يُنقل بمساره داخل الحقيبة، فما يضيفه القالب لاحقاً تأخذه الحقيبة
 * دون تعديل هنا. ما كتبه صاحب المشروع لا يُمس، وما تضيفه الحقيبة يُسجَّل (added) لتُزيله --remove وحده.
 */
const KIT_MARK = '.claude/launchpad/';
// قراءة نتيجة الفحص فقط؛ تشغيل الفحص نفسه يبقى بموافقة صاحب المشروع لأنه ينفّذ أوامر مشروعه
const KIT_ALLOW = ['Bash(node .claude/launchpad/scripts/verify.mjs --status)'];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isKitCommand = (command) => String(command || '').replace(/\\/g, '/').includes(KIT_MARK);
const relocate = (command) => String(command)
  .replace('/.claude/hooks/', `/${KIT_MARK}hooks/`).replace('/.claude/statusline.mjs', `/${KIT_MARK}statusline.mjs`);

// قوائم الصلاحيات التي تُدمج وتُزال: منع قراءة الأسرار، وسؤالك قبل أوامر Git المدمّرة و rm -rf، وقراءة نتيجة الفحص
const PERMISSION_LISTS = ['deny', 'ask', 'allow'];

/** Hooks القالب وسطر حالته وصلاحياته الحامية، بمسارات الحقيبة. */
export function kitSettings(templateSettings) {
  const hooks = {};
  for (const [event, groups] of Object.entries(templateSettings.hooks || {})) {
    hooks[event] = groups.map((group) => ({ ...group, hooks: group.hooks.map((hook) => ({ ...hook, command: relocate(hook.command) })) }));
  }
  const line = templateSettings.statusLine;
  return {
    hooks,
    statusLine: line ? { ...line, command: relocate(line.command) } : null,
    deny: [...(templateSettings.permissions?.deny || [])],
    ask: [...(templateSettings.permissions?.ask || [])],
    allow: KIT_ALLOW,
  };
}

/** Hooks المشروع بعد حذف ما يخص الحقيبة منها؛ المجموعات التي تفرغ تُحذف، وما عداها يبقى كما هو. */
function withoutKitHooks(hooks) {
  const result = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      result[event] = groups;
      continue;
    }
    const kept = groups
      .map((group) => (isObject(group) && Array.isArray(group.hooks)
        ? { ...group, hooks: group.hooks.filter((hook) => !isKitCommand(hook?.command)) } : group))
      .filter((group) => !isObject(group) || !Array.isArray(group.hooks) || group.hooks.length);
    if (kept.length) result[event] = kept;
  }
  return result;
}

/**
 * يدمج الحقيبة في إعدادات قائمة. تحديث الحقيبة يستبدل Hooks نسختها السابقة ولا يكررها.
 * سطر الحالة يُضبط فقط إذا لم يكن لصاحب المشروع سطر خاص به. يعيد { settings, added }.
 */
export function mergeSettings(existing, kit, previouslyAdded = {}) {
  const settings = isObject(existing) ? structuredClone(existing) : {};
  settings.hooks = withoutKitHooks(isObject(settings.hooks) ? settings.hooks : {});
  for (const [event, groups] of Object.entries(kit.hooks)) settings.hooks[event] = [...(settings.hooks[event] || []), ...groups];

  const permissions = isObject(settings.permissions) ? settings.permissions : {};
  const added = { statusLine: false };
  for (const key of PERMISSION_LISTS) {
    added[key] = [...(previouslyAdded[key] || [])];
    const rules = Array.isArray(permissions[key]) ? permissions[key] : [];
    for (const rule of kit[key]) {
      if (rules.includes(rule)) continue;
      rules.push(rule);
      if (!added[key].includes(rule)) added[key].push(rule);
    }
    permissions[key] = rules;
  }
  settings.permissions = permissions;

  if (kit.statusLine && (!settings.statusLine || isKitCommand(settings.statusLine.command))) {
    settings.statusLine = kit.statusLine;
    added.statusLine = true;
  }
  return { settings, added };
}

/** يعيد الإعدادات كما كانت قبل الحقيبة: يحذف Hooks الحقيبة وسطر حالتها وما أضافته من صلاحيات فقط. */
export function removeSettings(existing, added = {}) {
  const settings = structuredClone(existing);
  if (isObject(settings.hooks)) {
    settings.hooks = withoutKitHooks(settings.hooks);
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
  }
  if (isObject(settings.permissions)) {
    for (const key of PERMISSION_LISTS) {
      if (!Array.isArray(settings.permissions[key])) continue;
      settings.permissions[key] = settings.permissions[key].filter((rule) => !(added[key] || []).includes(rule));
      if (!settings.permissions[key].length) delete settings.permissions[key];
    }
    if (!Object.keys(settings.permissions).length) delete settings.permissions;
  }
  if (isKitCommand(settings.statusLine?.command)) delete settings.statusLine;
  return settings;
}
