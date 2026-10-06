/**
 * عدد الاختبارات الناجحة من مخرجات المشغّلات الشائعة، أو null إن لم يُعرف (verify.mjs).
 * به يكشف الفحص نقص الاختبارات بين فحصين ناجحين: علامة على حذف اختبار أو تعطيله (البند 16).
 * بعض المشغّلات تطبع ملخصاً لكل حزمة (cargo test، dotnet test، Maven متعدد الوحدات)، فتُجمع ملخصاتها كلها.
 */
const SUMMED = [
  { re: /test result: (?:ok|FAILED)\. (\d+) passed/g, count: (m) => Number(m[1]) }, // cargo test
  { re: /Passed!?\s+-\s+Failed:\s*\d+,\s+Passed:\s*(\d+)/g, count: (m) => Number(m[1]) }, // dotnet test (VSTest)
  { re: /Test summary: total: \d+, failed: \d+, succeeded: (\d+)/gi, count: (m) => Number(m[1]) }, // dotnet test (Testing Platform)
  // Maven: سطر الملخص وحده (أسطر الأصناف تنتهي بـ Time elapsed فلا تطابق)
  { re: /^(?:\[\w+\]\s*)?Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm, count: (m) => m[1] - m[2] - m[3] - m[4] },
];

const FIRST = [
  /Tests:?\s+(?:\d+\s+(?:failed|skipped|todo)[,|\s]+)*(\d+)\s+passed/i, // Vitest / Jest
  /\+(\d+)(?:\s+~\d+)?(?:\s+-\d+)?:\s+(?:All tests passed|Some tests failed)/, // Flutter / Dart
  /^#\s*pass\s+(\d+)/m, // node:test
  /OK \((\d+) tests?,/, // PHPUnit
  /(\d+) examples?, 0 failures/, // RSpec
  /(\d+) runs?, \d+ assertions?, 0 failures/, // Minitest
  /Ran (\d+) tests? in [\d.]+s\s+OK/, // unittest
  /(\d+)\s+passed/i, // pytest وأي مشغّل يطبع «N passed»
];

// XCTest يطبع «Executed N tests» لكل مجموعة ثم للمجموع، فالأخير هو العدد الكلي
const XCTEST = /Executed (\d+) tests?, with 0 failures/g;

export function parsePassedTests(output) {
  const text = String(output || '');
  for (const { re, count } of SUMMED) {
    const matches = [...text.matchAll(re)];
    if (matches.length) return matches.reduce((sum, match) => sum + count(match), 0);
  }
  const xctest = [...text.matchAll(XCTEST)];
  if (xctest.length) return Number(xctest[xctest.length - 1][1]);
  for (const re of FIRST) {
    const match = text.match(re);
    if (match) return Number(match[1]);
  }
  return null;
}
