/**
 * أنماط الكشف المستخدمة في guard-secrets.mjs (البندان 5 و 6 — rules_security.md).
 * HIGH = مفاتيح مؤكدة الشكل (رفض)، MEDIUM = اشتباه يحتاج قرار المستخدم (سؤال).
 */
export const SECRET_HIGH = [
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{48}\b/ },
  { name: 'Stripe live key', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}/ },
  { name: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/ },
  { name: 'Google/Firebase API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, publicInFirebaseConfig: true },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
];

const PLACEHOLDER_VALUE = /your|example|placeholder|changeme|xxx|dummy|sample|fake|<|\$\{|process\.env|import\.meta\.env|os\.environ|getenv/i;

export const SECRET_MEDIUM = [
  { name: 'JWT / service key', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: 'hard-coded credential',
    re: /(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|access[_-]?key)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
    accept: (match) => !PLACEHOLDER_VALUE.test(match[1] || ''),
  },
  {
    name: 'database URL with password',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:([^@\s]{6,})@([^/\s:]+)/gi,
    accept: (match) => !/^(localhost|127\.0\.0\.1|db|host\.docker\.internal)$/i.test(match[2] || '') && !PLACEHOLDER_VALUE.test(match[1] || ''),
  },
];

export const INJECTION = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts?)/i,
  /disregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|your)\s+(?:instructions|rules)/i,
  /تجاهل\s+(?:جميع\s+|كل\s+)?(?:التعليمات|القواعد|الأوامر)/,
  /\byou\s+are\s+now\s+(?:a|an|the|in)\b/i,
  /(?:new|override|reveal|print)\s+(?:the\s+|your\s+)?system\s+prompt/i,
  /\brm\s+-rf\s+(?:\/|~|\*|\$HOME)/i,
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z)?sh\b/i,
  /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*iex\b/i,
  /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
  /Remove-Item\b[^\n]*-Recurse\b[^\n]*-Force|\bdel\s+\/[sq]\b/i,
  /(?:send|upload|post|exfiltrate)\s[^\n]{0,40}(?:\.env|credentials|api\s*keys?|secrets)/i,
];

/** ملفات التعليمات وطبقة الإنفاذ: أي كتابة فيها تحتاج موافقة المستخدم الصريحة. */
export const PROTECTED_INSTRUCTION_PATHS = [
  /^\.claude\/(skills|agents|rules|hooks|scripts)\//,
  /^\.claude\/(settings\.json|statusline\.mjs)$/,
  /^skills\//,
  /^\.agents\//,
  /^\.cursor\//,
  /^\.cursorignore$/,
  /(^|\/)(CLAUDE|AGENTS)\.md$/,
  /^(master_rules|rules_security|rules_code_quality|rules_workflow|rules_ui)\.md$/,
];

/** ملفات القالب التي تحتوي عبارات الفحص نفسها كقوائم مرجعية — تأخذ سؤال الحوكمة العادي لا إنذار الحقن. */
export const INJECTION_SCAN_EXEMPT = [
  /^\.claude\/skills\/(import-skill|db-change|fix|launch-check)\/SKILL\.md$/,
  /^\.claude\/hooks\/lib\/patterns\.mjs$/,
  /^rules_security\.md$/,
];

/** مرجع لملف بيئة داخل أمر طرفية (يلتقط .env و .env.local و config/.env ...). */
export const ENV_REFERENCE = /(?:^|[\s'"=/\\(<>|;&:@,])(\.env(?:\.[A-Za-z0-9_-]+)*)(?=$|[\s'";|&)<>])/g;

// نمط glob في أداة البحث يستهدف ملفات بيئة حقيقية (مثل .env* أو .env.local في أي مجلد)، لا القوالب العامة.
export const ENV_GLOB = /(?:^|[\\/{,*])\.env(?!\.(?:example|sample|template|dist)(?![\w.-]))/i;

/** أوامر تقرأ محتوى الملف أو تنقله للخارج — رفض مباشر عند استهداف ملف بيئة حقيقي. */
export const READ_OR_EXFIL_COMMAND = /(?:^|[\s;|&(`$])(?:cat|type|more|less|head|tail|bat|nl|od|xxd|hexdump|strings|grep|egrep|fgrep|rg|findstr|awk|sed|cut|sort|uniq|diff|base64|openssl|Get-Content|gc|Select-String|sls|curl|wget|iwr|Invoke-WebRequest|Invoke-RestMethod|scp|rsync|git\s+(?:add|show|diff|stash))(?=\s|$)/i;

/** صيغ آمنة: إنشاء .env من القالب أو فحص وجوده فقط. */
export const SAFE_ENV_COMMANDS = [
  /\b(?:cp|copy|Copy-Item)(?:\s+-{1,2}[A-Za-z-]+)*\s+["']?[^\s"']*\.env\.(?:example|sample|template)["']?\s+["']?[^\s"']*\.env["']?/gi,
  /(?:\btest\s+-[efs]|\[\s+-[efs]|\bTest-Path)\s+["']?[^\s"']*\.env["']?/gi,
];

/** إشارة إلى ملف حساب خدمة Firebase/Google داخل أمر طرفية. */
export const SERVICE_ACCOUNT_REFERENCE = /[^\s'"]*(?:adminsdk|service[-_]?account)[^\s'"]*\.json/gi;
