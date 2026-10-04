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
// المطابقة بلا حساسية لحالة الأحرف: على Windows و macOS المسار ‎.CLAUDE/SETTINGS.JSON هو الملف نفسه
export const PROTECTED_INSTRUCTION_PATHS = [
  /^\.claude\/(skills|agents|rules|hooks|scripts)\//i,
  /^\.claude\/(settings(\.local)?\.json|statusline\.mjs)$/i,
  /^skills\//i,
  /^\.agents\//i,
  /^\.cursor\//i,
  /^\.cursorignore$/i,
  /(^|\/)(CLAUDE|AGENTS)\.md$/i,
  /^(master_rules|rules_security|rules_code_quality|rules_workflow|rules_ui)\.md$/i,
];

/** ملفات القالب التي تحتوي عبارات الفحص نفسها كقوائم مرجعية — تأخذ سؤال الحوكمة العادي لا إنذار الحقن. */
export const INJECTION_SCAN_EXEMPT = [
  /^\.claude\/skills\/(import-skill|db-change|fix|launch-check)\/SKILL\.md$/,
  /^\.claude\/hooks\/lib\/patterns\.mjs$/,
  /^rules_security\.md$/,
];

/** مرجع لملف بيئة داخل أمر طرفية (يلتقط .env و .env.local و config/.env ...). */
export const ENV_REFERENCE = /(?:^|[\s'"=/\\(<>|;&:@,])(\.env(?:\.[A-Za-z0-9_-]+)*)(?=$|[\s'";|&)<>])/gi;

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

// ───── حواجز ضد ما يحاوله وكيل مخدوع بنص مدسوس (lib/threats.mjs) ─────

/** طبقة الإنفاذ نفسها: تعديلها يعطّل الحماية، فلا يمرّ في أداة بلا نافذة موافقة. */
export const ENFORCEMENT_PATHS = [
  /^\.claude\/(hooks|scripts)\//i,
  /^\.claude\/settings(\.local)?\.json$/i,
  /^\.cursor\//i,
  /^\.cursorignore$/i,
];

/** مجلدات محمية كما تُذكر في الأوامر بلا شرطة ختامية (rm -rf .claude/hooks). */
export const PROTECTED_DIRS = ['.claude', '.claude/skills', '.claude/agents', '.claude/rules', '.claude/hooks', '.claude/scripts', '.agents', '.cursor'];

/** «نزّل وشغّل»: محتوى يُجلب من الإنترنت ويُنفَّذ فوراً. معالجة البيانات (| jq ، | node -e "…") لا تطابق. */
export const REMOTE_EXEC = [
  /\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:env\s+\S+\s+)*(?:ba|z|da|k|fi)?sh\b/i,
  /\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:python[0-9.]*|node|perl|ruby|php|pwsh|powershell)(?:\.exe)?\s*(?:-\s*)?(?=$|[;&|)\n])/i,
  /\b(?:iwr|irm|curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[^|;\n]*\|\s*(?:iex|Invoke-Expression)\b/i,
  /\b(?:iex|Invoke-Expression)\b[^;\n]*\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b/i,
  /\b(?:ba|z|da|k|fi)?sh\s+(?:-[a-z]+\s+)*-c\s+["']?\s*(?:\$\(|`)\s*(?:curl|wget)\b/i,
  /(?:^|[\s;&|(])(?:(?:ba|z|da|k|fi)?sh|source|\.)\s+<\(\s*(?:curl|wget)\b/i,
  /\beval\s+["']?\s*(?:\$\(|`)\s*(?:curl|wget)\b/i,
];
/** تنزيل سكربت إلى ملف (يُفحص بعده هل يُشغَّل الملف نفسه في الأمر ذاته). */
export const DOWNLOAD_TO_SCRIPT = /\s(?:-o|-O|--output(?:-document)?|-OutFile)[=\s]+["']?([^\s"';|&]+\.(?:sh|bash|zsh|ps1|bat|cmd|py|js|mjs|rb|pl))["']?/gi;
export const SCRIPT_RUNNER = String.raw`(?:\b(?:(?:ba|z|da|k|fi)?sh|python[0-9.]*|node|pwsh|powershell|perl|ruby|php|source|chmod)\b[^;&|\n]*|(?:^|[\s;&|])\.{1,2}[\\/])`;

/** رفع ملف من الجهاز إلى خادم. إرسال JSON مكتوب في الأمر نفسه (-d '{"a":1}') لا يطابق. */
export const UPLOAD = [
  /\bcurl\b[^;\n]*\s(?:-d|--data(?:-binary|-ascii|-urlencode)?|--json)(?:=|\s+)["']?(?:[\w.-]*=)?@/,
  /\bcurl\b[^;\n]*\s(?:-F|--form)(?:=|\s+)["']?[^\s"']*=[@<]/,
  /\bcurl\b[^;\n]*\s(?:-T|--upload-file)(?:=|\s+)/,
  /\bwget\b[^;\n]*\s--(?:post|body)-file\b/i,
  /\b(?:Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b[^;\n]*\s-InFile\b/i,
  /\b(?:Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b[^;\n]*\s-Body\s*\(?\s*\$?\(?\s*(?:Get-Content|gc|cat|type)\b/i,
  /\.Upload(?:File|String|Data)\s*\(/i,
  /\b(?:scp|rsync)\b[^;|&\n]*\s(?:[\w.-]+@)?[\w.-]{2,}:(?!\/\/)\S*/i,
  /\|\s*(?:nc|ncat|netcat)\b/i,
  /\b(?:nc|ncat|netcat)\b[^;|\n]*<\s*\S/i,
];
export const URL_HOST = /https?:\/\/(\[[^\]]+\]|[^/\s:'"@]+)/gi;
export const LOCAL_HOST = /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\]|host\.docker\.internal|[\w-]+\.(?:localhost|test))$/i;

/** مخازن مفاتيح وبيانات دخول: لا تُقرأ ولا تُعدَّل. المفتاح العام (‎.pub) ومخزن التصحيح debug.keystore مستثنيان. */
export const SECRET_STORES = [
  /(^|\/)\.ssh(\/|$)/i, /(^|\/)\.aws(\/|$)/i, /(^|\/)\.azure(\/|$)/i, /(^|\/)\.config\/gcloud(\/|$)/i, /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.kube\/config$/i, /(^|\/)\.docker\/config\.json$/i, /(^|\/)(\.netrc|_netrc|\.git-credentials|\.pypirc)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i, /(^|\/)application_default_credentials\.json$/i,
  /^(?:~|\$HOME|\$env:USERPROFILE|%USERPROFILE%|\/(?:home|Users)\/[^/]+|[A-Za-z]:\/Users\/[^/]+)\/\.npmrc$/i,
];
/** ملفات توقيع داخل المشروع: تُعامل كملف البيئة (لا تُقرأ ولا تُعدَّل، ويُسمح بإنشائها أول مرة). */
export const PROJECT_KEY_FILES = [/\.(p12|pfx|jks)$/i, /(^|\/)(?!debug\.keystore$)[^/]*\.keystore$/i, /(^|\/)key\.properties$/];
/** قد يكون مفتاحاً خاصاً وقد يكون شهادة عامة: يُسأل المستخدم. */
export const KEY_MATERIAL = /\.(pem|key)$/i;

/** أوامر تعدّل الملفات أو تحذفها (الكلمة الأولى في مقطع الأمر). */
export const MUTATING_COMMANDS = new Set([
  'rm', 'rmdir', 'unlink', 'del', 'erase', 'rd', 'mv', 'move', 'ren', 'rename', 'cp', 'copy', 'xcopy', 'robocopy', 'tee', 'truncate', 'shred',
  'chmod', 'chown', 'icacls', 'attrib', 'ln', 'dd', 'set-content', 'add-content', 'out-file', 'clear-content', 'remove-item', 'move-item',
  'rename-item', 'copy-item', 'new-item', 'ri', 'mi', 'rni', 'cpi', 'ni',
]);
export const MUTATING_GIT = /^(?:rm|mv|checkout|restore|clean|apply|reset|stash)$/;
export const SHELL_WRAPPERS = new Set(['powershell', 'pwsh', 'cmd', 'bash', 'sh', 'zsh']);
export const SCRIPT_INTERPRETERS = new Set(['node', 'deno', 'bun', 'python', 'python3', 'py', 'ruby', 'php']);
/** كتابة أو حذف من داخل سكربت سطر واحد (node -e ، python -c) أو أمر مغلَّف (powershell -Command "…"). */
export const INLINE_WRITE = /writeFile|appendFile|unlink|rmSync|rmdir|renameSync|copyFile|cpSync|createWriteStream|truncate|\bopen\([^)]*['"][wa]|write_text|shutil\.|os\.(?:remove|rename|unlink)|Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Move-Item|Rename-Item|Copy-Item|\b(?:rm|del|mv|cp|tee)\s/i;
