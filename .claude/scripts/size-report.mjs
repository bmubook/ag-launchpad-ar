#!/usr/bin/env node
/**
 * تقرير أحجام الملفات (البندان 14 و 29): يسرد الملفات التي بلغت الحد الأدنى لسقفها أو تجاوزت الأقصى.
 * الاستخدام: node .claude/scripts/size-report.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ceilingFor, ceilingStatus, countLines } from '../hooks/lib/ceilings.mjs';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.output', 'coverage',
  '.dart_tool', '.gradle', 'Pods', '.venv', 'venv', '__pycache__', 'vendor', '.turbo', '.cache',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

function* walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const isStateDir = relative(root, full).replace(/\\/g, '/') === '.claude/state';
      if (!IGNORED_DIRS.has(entry.name) && !isStateDir) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function collect() {
  const findings = [];
  for (const full of walk(root)) {
    const rel = relative(root, full).replace(/\\/g, '/');
    const rule = ceilingFor(rel);
    if (!rule) continue;
    try {
      if (statSync(full).size > MAX_FILE_BYTES) continue;
      const lines = countLines(readFileSync(full, 'utf8'));
      const status = ceilingStatus(lines, rule);
      if (status) findings.push({ file: rel, kind: rule.label, lines, soft: rule.soft, hard: rule.hard, status });
    } catch { /* ملف غير قابل للقراءة — يُتجاهل */ }
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
