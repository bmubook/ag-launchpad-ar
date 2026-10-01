#!/usr/bin/env node
/**
 * تقرير أحجام الملفات (البندان 14 و 29): يسرد الملفات التي بلغت الحد الأدنى لسقفها أو تجاوزت الأقصى.
 * الاستخدام: node .claude/scripts/size-report.mjs [--json]
 */
import { resolve } from 'node:path';
import { ceilingFor, ceilingStatus, countLines } from '../hooks/lib/ceilings.mjs';
import { readText, walkFiles } from '../hooks/lib/files.mjs';

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

function collect() {
  const findings = [];
  for (const rel of walkFiles(root)) {
    const rule = ceilingFor(rel);
    if (!rule) continue;
    const text = readText(root, rel);
    if (text === null) continue;
    const lines = countLines(text);
    const status = ceilingStatus(lines, rule);
    if (status) findings.push({ file: rel, kind: rule.label, lines, soft: rule.soft, hard: rule.hard, status });
  }
  return findings.sort((a, b) => (b.lines / b.hard) - (a.lines / a.hard));
}

function toMarkdown(findings) {
  if (!findings.length) return '✅ لا توجد ملفات قريبة من سقفها (البند 14).';
  const overCount = findings.filter((f) => f.status === 'hard').length;
  return [
    `📏 تقرير أحجام الملفات — ${findings.length} ملف (${overCount} متجاوز للسقف الأقصى):`,
    '',
    '| الملف | النوع | الأسطر | السقف | الحالة |',
    '| :--- | :--- | :---: | :---: | :---: |',
    ...findings.map((f) => `| \`${f.file}\` | ${f.kind} | ${f.lines} | ${f.soft}–${f.hard} | ${f.status === 'hard' ? '🚨 متجاوز' : '⚠️ قريب'} |`),
  ].join('\n');
}

const findings = collect();
process.stdout.write(process.argv.includes('--json') ? JSON.stringify(findings, null, 2) : `${toMarkdown(findings)}\n`);
