// إضافة AG Launchpad AR لـ OpenCode 2: تشغّل حماية القالب (Hooks في .claude/hooks) داخل OpenCode.
// المنطق كله في .claude/hooks/lib/opencode.mjs حتى يُختبر مع بقية الـ Hooks؛ هذا الملف نقطة التحميل فقط.
import { createBridge } from '../../.claude/hooks/lib/opencode.mjs';

export default {
  id: 'ag-launchpad',
  setup: (ctx) => createBridge(ctx),
};
