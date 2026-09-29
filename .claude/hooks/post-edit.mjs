#!/usr/bin/env node
/**
 * Hook ما بعد التعديل (PostToolUse):
 * 1) يسجّل الملف المعدّل في قائمة الجولة الحالية (يستخدمها stop-docs-check.mjs).
 * 2) يراقب سقف حجم الملف حسب نوعه (البند 14 — rules_code_quality.md) ويُنبّه الوكيل.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addContext, loadSession, projectDir, readStdinJson, runHook, saveSession, toProjectRelative,
} from './lib/common.mjs';
import { ceilingFor, ceilingStatus, countLines } from './lib/ceilings.mjs';

/** يسجّل التعديل ويعيد true إذا كانت حالة السقف جديدة لهذا الملف (منعاً لتكرار التنبيه نفسه). */
function recordEdit(sessionId, relPath, status) {
  const session = loadSession(sessionId);
  if (!session.edited.includes(relPath)) session.edited.push(relPath);
  const isNewStatus = Boolean(status) && session.warned[relPath] !== status;
  if (status) session.warned[relPath] = status;
  else delete session.warned[relPath];
  saveSession(sessionId, session);
  return isNewStatus;
}

function currentStatus(relPath) {
  const rule = ceilingFor(relPath);
  if (!rule) return { rule: null, lines: 0, status: null };
  try {
    const lines = countLines(readFileSync(resolve(projectDir(), relPath), 'utf8'));
    return { rule, lines, status: ceilingStatus(lines, rule) };
  } catch {
    return { rule, lines: 0, status: null };
  }
}

function ceilingMessage(relPath, lines, rule, status) {
  if (status === 'hard') {
    return `🚨 تجاوز سقف الحجم (البند 14): ${relPath} أصبح ${lines} سطراً، والسقف الأقصى لـ${rule.label} هو ${rule.hard}. `
      + 'يجب تقسيمه إلى وحدات متخصصة (Modular Architecture) قبل إضافة أي ميزة جديدة، مع إبلاغ المستخدم لأنها إشارة تضخم (البند 29). '
      + 'لا تقسّم تقسيماً شكلياً — قسّم فقط بما يحسّن القراءة والصيانة.';
  }
  return `⚠️ اقتراب من سقف الحجم (البند 14): ${relPath} بلغ ${lines} سطراً (نطاق ${rule.label}: ${rule.soft}–${rule.hard}). `
    + 'خطّط للتقسيم إذا كان التعديل القادم سيضيف منطقاً جديداً لهذا الملف.';
}

runHook(async () => {
  const input = await readStdinJson();
  const toolInput = input.tool_input || {};
  const target = toolInput.file_path || toolInput.notebook_path;
  const relPath = toProjectRelative(target);
  if (!relPath) return;

  const { rule, lines, status } = currentStatus(relPath);
  const shouldWarn = recordEdit(input.session_id, relPath, status);
  if (shouldWarn || status === 'hard') addContext('PostToolUse', ceilingMessage(relPath, lines, rule, status));
});
