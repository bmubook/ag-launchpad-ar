/**
 * أدوات مشتركة لتركيب حقيبة الحارس: خطأ يُعرض لصاحب المشروع كما هو، وقراءة ملفات JSON التي يُدمج فيها،
 * وكتل الأسطر التي تُضاف إلى ملفات التجاهل (.gitignore و .cursorignore) وتُزال منها بعينها.
 */
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';

/** خطأ يُعرض لصاحب المشروع كما هو، دون تتبع برمجي. */
export class KitError extends Error {}

export const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const readJsonFile = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
export const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
export const list = (dir) => { try { return readdirSync(dir); } catch { return []; } };
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function removeIfEmpty(dir) {
  try {
    if (!readdirSync(dir).length) rmdirSync(dir);
  } catch { /* المجلد غير موجود أو غير فارغ: يبقى كما هو */ }
}

/**
 * ملف إعداد يدمج فيه الحارس: null إن لم يوجد، و {} إن كان فارغاً. الملف التالف، أو الذي ليس كائناً،
 * يوقف التركيب قبل أي تغيير؛ لأن الدمج فيه قد يمحو ما كتبه صاحبه.
 */
export function readConfigJson(path, label) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  let value = null;
  try { value = JSON.parse(text); } catch { value = null; }
  if (!isObject(value)) throw new KitError(`${label} ليس JSON صالحاً، فلم أغيّر شيئاً. أصلحه ثم أعد الأمر.`);
  return value;
}

/** يضيف كتلة أسطر إلى آخر ملف تجاهل إن لم تكن فيه. يعيد true إن أضافها. */
export function addBlock(path, block) {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (text.replace(/\r\n/g, '\n').includes(block.join('\n'))) return false;
  const separator = !text ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(path, `${text}${separator}${block.join('\n')}\n`);
  return true;
}

/** يزيل الكتلة نفسها وحدها؛ والملف الذي أنشأه الحارس يُحذف إن لم يبق فيه غيرها. */
export function removeBlock(path, block, createdFile) {
  if (!existsSync(path)) return;
  const pattern = new RegExp(`(\\r?\\n)?${block.map(escapeRegex).join('\\r?\\n')}\\r?\\n?`);
  const text = readFileSync(path, 'utf8').replace(pattern, '');
  if (createdFile && !text.trim()) rmSync(path, { force: true });
  else writeFileSync(path, text);
}
