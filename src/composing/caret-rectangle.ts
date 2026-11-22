/** Measure native textarea text with its actual metrics, wrapping and scroll, without changing its value/selection. */
export function caretRectangle(editor: HTMLTextAreaElement): DOMRect {
  const doc = editor.ownerDocument;
  const style = doc.defaultView!.getComputedStyle(editor);
  const mirror = doc.createElement('div');
  const metrics = [
    'box-sizing',
    'width',
    'height',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'font-variant',
    'font-stretch',
    'line-height',
    'letter-spacing',
    'word-spacing',
    'tab-size',
    'text-indent',
    'text-align',
    'text-transform',
    'direction',
    'white-space',
    'overflow-wrap',
    'word-break',
    'overflow-x',
    'overflow-y',
  ];
  for (const property of metrics) mirror.style.setProperty(property, style.getPropertyValue(property));
  const bounds = editor.getBoundingClientRect();
  Object.assign(mirror.style, {
    position: 'fixed',
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    margin: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
    borderStyle: 'solid',
    borderColor: 'transparent',
  });
  mirror.textContent = editor.value.slice(0, editor.selectionStart);
  const marker = doc.createElement('span');
  marker.textContent = editor.value.slice(editor.selectionStart) || '\u200b';
  mirror.append(marker);
  doc.body.append(mirror);
  try {
    mirror.scrollTop = editor.scrollTop;
    mirror.scrollLeft = editor.scrollLeft;
    const range = doc.createRange();
    range.setStart(marker.firstChild!, 0);
    range.setEnd(marker.firstChild!, 1);
    const caret = range.getBoundingClientRect();
    return new DOMRect(caret.left, caret.top, 1, caret.height);
  } finally {
    mirror.remove();
  }
}
