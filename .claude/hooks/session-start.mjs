#!/usr/bin/env node
/**
 * Hook بداية الجلسة (SessionStart) — بروتوكول بداية الجلسة الآلي (master_rules.md §12-أ).
 * يحقن ملخص حالة المشروع (lib/summary.mjs). عند source = "compact" يأمر الملخص بنقطة تفتيش فورية (§12-ب).
 */
import { addContext, pruneOldSessions, readStdinJson, runHook } from './lib/common.mjs';
import { buildSessionContext } from './lib/summary.mjs';

runHook(async () => {
  const input = await readStdinJson();
  pruneOldSessions();
  addContext('SessionStart', buildSessionContext(input.source || 'startup', input.host));
});
