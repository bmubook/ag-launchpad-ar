/**
 * طبقتا Cursor و OpenCode في حقيبة الحارس: تُركَّبان مع طبقة Claude Code، لأن صاحب المشروع قد يفتحه بأي منها.
 * المصدر ملفات القالب نفسها (.cursor/hooks.json و .cursorignore و opencode.json) بمسارات الحقيبة، فما يضيفه القالب
 * لاحقاً تأخذه الحقيبة دون تعديل هنا. ما كتبه صاحب المشروع لا يُمس، وما تضيفه الحقيبة يُسجَّل لتُزيله --remove وحده.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KitError, addBlock, isObject, readConfigJson, readJsonFile, removeBlock, removeIfEmpty, writeJson,
} from './common.mjs';

const KIT_MARK = '.claude/launchpad/';
export const CURSOR_HOOKS = '.cursor/hooks.json';
export const CURSOR_RULES = '.cursor/rules/launchpad-guard.mdc';
export const CURSOR_IGNORE = '.cursorignore';
export const OPENCODE_PLUGIN = '.opencode/plugins/launchpad-guard.js';
export const OPENCODE_CONFIG = 'opencode.json';
const OPENCODE_JSONC = 'opencode.jsonc';
const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';
const IGNORE_HEADER = '# AG Launchpad — ملفات الأسرار لا يقرؤها وكيل Cursor ولا يفهرسها (الحارس)';
/** كل ما تكتبه هذه الطبقة: لا يُتبع رابط رمزي في أي منها حتى لا تمتد الكتابة خارج المشروع. */
export const HOST_PATHS = ['.cursor', CURSOR_HOOKS, '.cursor/rules', CURSOR_RULES, CURSOR_IGNORE, '.opencode', '.opencode/plugins', OPENCODE_PLUGIN, OPENCODE_CONFIG];

const PLUGIN_SOURCE = [
  '// حارس AG Launchpad في OpenCode 2: يشغّل حواجز الحقيبة (.claude/launchpad/hooks) داخل OpenCode.',
  '// يضيفه أمر تركيب الحارس ويزيله؛ لا تعدّله، فالتحديث يستبدله.',
  "import { createBridge } from '../../.claude/launchpad/hooks/lib/opencode.mjs';",
  '',
  'export default {',
  "  id: 'launchpad-guard',",
  '  setup: (ctx) => createBridge(ctx),',
  '};',
  '',
].join('\n');

const isKitCommand = (command) => String(command || '').replace(/\\/g, '/').includes(KIT_MARK);
const relocate = (command) => String(command).replace(/(^|[\s"'/])\.claude\/hooks\//g, `$1${KIT_MARK}hooks/`);
const ruleKey = (rule) => JSON.stringify([rule?.action, rule?.resource, rule?.effect]);

/** قاعدة Cursor الدائمة: قواعد الحارس نفسها، يحمّلها Cursor في كل محادثة. */
const cursorRule = (rulesText) => `---\ndescription: قواعد حارس AG Launchpad (يضيفها أمر تركيب الحارس ويزيلها)\nalwaysApply: true\n---\n\n${rulesText}`;

/** ما يُركَّب لـ Cursor و OpenCode من ملفات القالب، بمسارات الحقيبة. */
function hostSources(template) {
  const cursor = readJsonFile(join(template, CURSOR_HOOKS));
  const opencode = readJsonFile(join(template, OPENCODE_CONFIG));
  const ignore = existsSync(join(template, CURSOR_IGNORE)) ? readFileSync(join(template, CURSOR_IGNORE), 'utf8') : '';
  if (!isObject(cursor?.hooks) || !Array.isArray(opencode?.permissions) || !ignore) {
    throw new KitError('لم أجد ملفات Cursor و OpenCode في القالب. حمّل القالب كاملاً ثم أعد المحاولة.');
  }
  const hooks = {};
  for (const [event, entries] of Object.entries(cursor.hooks)) hooks[event] = entries.map((entry) => ({ ...entry, command: relocate(entry.command) }));
  const ignoreLines = ignore.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return { hooks, permissions: opencode.permissions, ignoreBlock: [IGNORE_HEADER, ...ignoreLines] };
}

/** Hooks مشروع Cursor بعد حذف ما يخص الحقيبة منها؛ الأحداث التي تفرغ تُحذف، وما ليس قائمة يبقى كما هو. */
function withoutKitEntries(hooks) {
  const result = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      result[event] = entries;
      continue;
    }
    const kept = entries.filter((entry) => !isKitCommand(entry?.command));
    if (kept.length) result[event] = kept;
  }
  return result;
}

/**
 * يقرأ ما يلزم ويتحقق منه قبل أي كتابة: ملف تالف أو بشكل غير متوقع يوقف التركيب كله.
 * previous = ما سجّله تركيب سابق، فلا يُعدّ ما أنشأته الحقيبة من قبل ملكاً لصاحب المشروع عند التحديث.
 */
export function prepareHosts(target, template, previous = {}) {
  const sources = hostSources(template);
  const cursor = readConfigJson(join(target, CURSOR_HOOKS), CURSOR_HOOKS);
  if (cursor?.hooks !== undefined && (!isObject(cursor.hooks) || Object.values(cursor.hooks).some((entries) => !Array.isArray(entries)))) {
    throw new KitError(`${CURSOR_HOOKS}: الحقل hooks بشكل غير متوقع، فلم أغيّر شيئاً. أصلحه ثم أعد الأمر.`);
  }
  // opencode.jsonc فيه تعليقات تضيع بإعادة الكتابة، فلا يُمس؛ وإضافة الحارس تمنع ملفات الأسرار وحدها
  const jsonc = existsSync(join(target, OPENCODE_JSONC));
  const opencode = jsonc ? null : readConfigJson(join(target, OPENCODE_CONFIG), OPENCODE_CONFIG);
  if (opencode?.permissions !== undefined && !Array.isArray(opencode.permissions)) {
    throw new KitError(`${OPENCODE_CONFIG}: الحقل permissions بشكل غير متوقع، فلم أغيّر شيئاً. أصلحه ثم أعد الأمر.`);
  }
  if (!previous.created) {
    const foreign = [CURSOR_RULES, OPENCODE_PLUGIN].find((rel) => existsSync(join(target, rel)));
    if (foreign) throw new KitError(`${foreign} موجود في المشروع وليس من تركيب سابق للحارس، فلم أغيّر شيئاً. انقله أو أعد تسميته ثم أعد الأمر.`);
  }
  const created = previous.created || {
    cursorDir: !existsSync(join(target, '.cursor')),
    cursorRulesDir: !existsSync(join(target, '.cursor', 'rules')),
    cursorHooks: !cursor,
    cursorIgnore: !existsSync(join(target, CURSOR_IGNORE)),
    opencodeDir: !existsSync(join(target, '.opencode')),
    pluginsDir: !existsSync(join(target, '.opencode', 'plugins')),
    opencodeConfig: !jsonc && !opencode,
  };
  const keysAdded = previous.keysAdded || {
    cursorVersion: Boolean(cursor) && cursor.version === undefined,
    cursorHooks: Boolean(cursor) && cursor.hooks === undefined,
    permissions: Boolean(opencode) && opencode.permissions === undefined,
  };
  return { target, sources, cursor, opencode, jsonc, created, keysAdded, previous };
}

/** يكتب الطبقتين ويعيد ما يُحفظ في manifest لتُزيله --remove بعينه. */
export function applyHosts(plan, rulesText) {
  const { target, sources, cursor, opencode, jsonc, created, keysAdded, previous } = plan;
  // Cursor: سجل Hooks الأصلي (نسخة الحقيبة السابقة تُستبدل ولا تتكرر)، وقاعدة دائمة، وملفات الأسرار في .cursorignore
  const hooks = withoutKitEntries(isObject(cursor?.hooks) ? cursor.hooks : {});
  for (const [event, entries] of Object.entries(sources.hooks)) hooks[event] = [...(hooks[event] || []), ...entries];
  mkdirSync(join(target, '.cursor', 'rules'), { recursive: true });
  writeJson(join(target, CURSOR_HOOKS), { version: 1, ...(cursor || {}), hooks });
  writeFileSync(join(target, CURSOR_RULES), cursorRule(rulesText));
  const ignorePath = join(target, CURSOR_IGNORE);
  if (previous.ignoreBlock && previous.ignoreBlock.join('\n') !== sources.ignoreBlock.join('\n')) removeBlock(ignorePath, previous.ignoreBlock, false);
  const ignoreAdded = addBlock(ignorePath, sources.ignoreBlock) || Boolean(previous.ignoreAdded);

  // OpenCode: الإضافة تحمّل جسر الحقيبة، والصلاحيات تمنع ملفات الأسرار حتى لو لم يجد OpenCode برنامج Node
  mkdirSync(join(target, '.opencode', 'plugins'), { recursive: true });
  writeFileSync(join(target, OPENCODE_PLUGIN), PLUGIN_SOURCE);
  const permissionsAdded = [...(previous.permissionsAdded || [])];
  if (!jsonc) {
    const config = opencode ? structuredClone(opencode) : { $schema: OPENCODE_SCHEMA };
    const rules = Array.isArray(config.permissions) ? config.permissions : [];
    const present = new Set(rules.map(ruleKey));
    for (const rule of sources.permissions) {
      if (present.has(ruleKey(rule))) continue;
      rules.push(rule);
      if (!permissionsAdded.includes(ruleKey(rule))) permissionsAdded.push(ruleKey(rule));
    }
    config.permissions = rules;
    writeJson(join(target, OPENCODE_CONFIG), config);
  }
  return { created, keysAdded, ignoreAdded, ignoreBlock: sources.ignoreBlock, permissionsAdded, opencodeJsonc: jsonc };
}

/** يعيد ملفات Cursor و OpenCode كما كانت قبل الحقيبة. تركيب أقدم بلا هذه الطبقة لا يُمس فيه شيء. */
export function removeHosts(target, manifest) {
  if (!isObject(manifest)) return;
  const { created = {}, keysAdded = {}, permissionsAdded = [] } = manifest;
  const cursorPath = join(target, CURSOR_HOOKS);
  const cursor = readJsonFile(cursorPath);
  if (isObject(cursor)) {
    const cleaned = { ...cursor, hooks: withoutKitEntries(isObject(cursor.hooks) ? cursor.hooks : {}) };
    if (keysAdded.cursorHooks && !Object.keys(cleaned.hooks).length) delete cleaned.hooks;
    if (keysAdded.cursorVersion) delete cleaned.version;
    if (created.cursorHooks && !Object.keys(cleaned.hooks || {}).length) rmSync(cursorPath, { force: true });
    else writeJson(cursorPath, cleaned);
  }
  rmSync(join(target, CURSOR_RULES), { force: true });
  if (manifest.ignoreAdded && manifest.ignoreBlock) removeBlock(join(target, CURSOR_IGNORE), manifest.ignoreBlock, created.cursorIgnore);

  const configPath = join(target, OPENCODE_CONFIG);
  const config = manifest.opencodeJsonc ? null : readJsonFile(configPath);
  if (isObject(config) && Array.isArray(config.permissions)) {
    const cleaned = { ...config, permissions: config.permissions.filter((rule) => !permissionsAdded.includes(ruleKey(rule))) };
    if (keysAdded.permissions && !cleaned.permissions.length) delete cleaned.permissions;
    if (created.opencodeConfig && Object.keys(cleaned).every((key) => key === '$schema' || (key === 'permissions' && !cleaned.permissions.length))) {
      rmSync(configPath, { force: true });
    } else writeJson(configPath, cleaned);
  }
  rmSync(join(target, OPENCODE_PLUGIN), { force: true });
  if (created.pluginsDir) removeIfEmpty(join(target, '.opencode', 'plugins'));
  if (created.opencodeDir) removeIfEmpty(join(target, '.opencode'));
  if (created.cursorRulesDir) removeIfEmpty(join(target, '.cursor', 'rules'));
  if (created.cursorDir) removeIfEmpty(join(target, '.cursor'));
}
