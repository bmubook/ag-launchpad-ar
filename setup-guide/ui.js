/* أدوات العرض المشتركة لمولّد الإقلاع: إنشاء العناصر بأمان، بطاقات المراجعة، التنبيه، والنسخ. */
(function () {
  'use strict';

  /** إنشاء عنصر بنص آمن (textContent) — بيانات المستخدم لا تمر عبر innerHTML أبداً. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** بطاقة مراجعة: عنوان + زر «تعديل» + قائمة (التسمية ← القيمة). */
  function reviewGroup(title, rows, onEdit) {
    const edit = el('button', 'btn-link', 'تعديل');
    edit.type = 'button';
    edit.setAttribute('aria-label', `تعديل ${title}`);
    edit.addEventListener('click', onEdit);
    const head = el('div', 'review-head');
    head.append(el('h3', '', title), edit);
    const dl = el('dl');
    rows.forEach(([label, value]) => dl.append(el('dt', '', label), el('dd', '', value)));
    const group = el('div', 'review-group');
    group.append(head, dl);
    return group;
  }

  function toast(message) {
    const box = document.getElementById('toast');
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => box.classList.remove('show'), 2600);
  }

  /** عند تعذّر النسخ التلقائي: تحديد النص ليتمكن المستخدم من نسخه يدوياً. */
  function selectText(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    toast('النص محدَّد — اضغط Ctrl+C (أو ⌘+C على Mac) لنسخه');
  }

  function copyText(node, button) {
    if (!navigator.clipboard) { selectText(node); return; }
    navigator.clipboard.writeText(node.textContent).then(() => {
      button.textContent = '✅ تم النسخ';
      button.classList.add('copied');
      toast('✅ تم النسخ — الصقه الآن في المحادثة');
      setTimeout(() => { button.textContent = '📋 نسخ النص'; button.classList.remove('copied'); }, 3000);
    }, () => selectText(node));
  }

  window.AGLUI = { el, reviewGroup, toast, copyText };
})();
