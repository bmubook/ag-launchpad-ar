#!/usr/bin/env node
/**
 * سطر الحالة في Claude Code: اسم النداء │ وضع التشغيل │ المرحلة النشطة │ حالة الفحص │ النموذج.
 * يقرأ project_map.md من مجلد المشروع الوارد في بيانات Claude Code (أو المجلد الحالي).
 * في حقيبة الحارس (مشروع قائم بلا project_map.md): 🛡️ الحارس │ حالة الفحص │ النموذج.
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
async function gateBadges(root, mode, kit = false) {
  try {
    const { gateStatus, loadQuality, unverifiedFiles } = await import('./hooks/lib/quality.mjs');
    const quality = loadQuality(root);
    const gate = gateStatus(mode, root);
    const badge = {
      green: '✅ مفحوص', red: '🔴 الفحص فاشل', partial: '🟠 فحص سريع فقط',
      stale: () => `🟠 غير مفحوص (${unverifiedFiles(root, quality).length})`,
      // في الحقيبة لا /quality-setup يجهّز الأوامر؛ الشارة تذكّر المحترف بأنها لم تُكتشف
      none: kit ? '⚪ لا أوامر فحص' : '',
    }[gate];
    const open = Object.keys(quality.shortcuts).length;
    return [typeof badge === 'function' ? badge() : badge || '', open ? `🚩 ${open}` : ''].filter(Boolean);
  } catch { /* الشارات اختيارية */ }
  return [];
}

/** سطر حقيبة الحارس (.claude/launchpad/statusline.mjs): الحارس والوضع والشارات، بلا مشروع قالب. null خارج الحقيبة. */
async function guardKitLine(root, tail) {
  try {
    const { GUARD_KIT, kitProjectState } = await import('./hooks/lib/kit.mjs');
    if (!GUARD_KIT) return null;
    const { mode } = kitProjectState(root);
    const badges = await gateBadges(root, mode, true);
    return ['🛡️ الحارس', mode === 'prototype' ? '🧪 prototype' : '', ...badges, ...tail].filter(Boolean).join(' │ ');
  } catch {
    return null;
  }
}

async function main() {
  const input = readInput();
  const root = input.workspace?.project_dir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const model = input.model?.display_name || '';
  const usage = input.context_window?.used_percentage;
  const tail = [model, typeof usage === 'number' ? `🧠 ${Math.round(usage)}%` : ''].filter(Boolean);

  const kitLine = await guardKitLine(root, tail);
  if (kitLine) {
    process.stdout.write(kitLine);
    return;
  }
  let map = '';
  try { map = readFileSync(join(root, 'project_map.md'), 'utf8'); } catch { /* خارج مشروع القالب */ }

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
