#!/usr/bin/env node
/**
 * سطر الحالة في Claude Code: اسم النداء │ وضع التشغيل │ المرحلة النشطة │ حالة الفحص │ النموذج.
 * يقرأ project_map.md من مجلد المشروع الوارد في بيانات Claude Code (أو المجلد الحالي).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readInput() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function anchor(map, label) {
  const match = map.match(new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*(.*)`));
  const value = match ? match[1].trim() : '';
  return !value || value.startsWith('[') ? null : value;
}

/** شارتا بوابة الإثبات والاختصارات المفتوحة: تُظهران للمستخدم الحالة الفعلية مهما قال الوكيل. */
async function gateBadges(root, mode) {
  try {
    const { gateStatus, loadQuality, unverifiedFiles } = await import('./hooks/lib/quality.mjs');
    const quality = loadQuality(root);
    const gate = gateStatus(mode, root);
    const badge = {
      green: '✅ مفحوص', red: '🔴 الفحص فاشل', partial: '🟠 فحص سريع فقط',
      stale: () => `🟠 غير مفحوص (${unverifiedFiles(root, quality).length})`,
    }[gate];
    const open = Object.keys(quality.shortcuts).length;
    return [typeof badge === 'function' ? badge() : badge || '', open ? `🚩 ${open}` : ''].filter(Boolean);
  } catch { /* الشارات اختيارية */ }
  return [];
}

async function main() {
  const input = readInput();
  const root = input.workspace?.project_dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let map = '';
  try { map = readFileSync(join(root, 'project_map.md'), 'utf8'); } catch { /* خارج مشروع القالب */ }

  const model = input.model?.display_name || '';
  const usage = input.context_window?.used_percentage;
  const tail = [model, typeof usage === 'number' ? `🧠 ${Math.round(usage)}%` : ''].filter(Boolean);

  if (!anchor(map, 'اسم المشروع')) {
    process.stdout.write(['🚀 /kickoff', ...tail].join(' │ '));
    return;
  }
  const callSign = anchor(map, 'اسم النداء \\(Call Sign\\)');
  const isPrototype = /prototype/i.test(anchor(map, 'وضع التشغيل النشط') || '');
  const mode = isPrototype ? '🧪 prototype' : '🏭 production';
  const phase = anchor(map, 'المرحلة النشطة حالياً');
  const learning = (anchor(map, 'وضع التعلّم') || '').replace(/[ً-ْ]/g, '');
  const learningBadge = /مفعل/.test(learning) && !/معطل/.test(learning) ? '🎓' : '';
  const gate = await gateBadges(root, isPrototype ? 'prototype' : 'production');
  const parts = [callSign ? `🎯 ${callSign}` : '', mode, phase ? `▶ ${phase}` : '', ...gate, learningBadge, ...tail].filter(Boolean);
  process.stdout.write(parts.join(' │ '));
}

main().catch(() => process.stdout.write('AG Launchpad AR'));
