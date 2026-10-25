import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const dom = new Window();
Object.assign(globalThis, {
  // CodeMirror's measuring checks `instanceof Window`.
  Window,
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver,
  Node: dom.Node,
  HTMLElement: dom.HTMLElement,
  MouseEvent: dom.MouseEvent,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { EditorView } = await import('@codemirror/view');
const { CodeMirrorEditor } = await import('@/components/ui/CodeMirrorEditor');
const { useLineNumberDragSelection } = await import('./useLineNumberDragSelection');

type LineRange = { start: number; end: number };
type Drag = ReturnType<typeof useLineNumberDragSelection>;

const DOC = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join('\n');
// The editor's visible box: 10 lines tall, starting at the top of the page.
const VISIBLE_LINES = 10;

let container: HTMLDivElement;
let root: Root;
let view: InstanceType<typeof EditorView> | null;
let selection: LineRange | null;
let drag: Drag | null;
let clears: number;
let scrollTop: number;

const Host = ({ initialSelection = null }: { initialSelection?: LineRange | null }) => {
  const [lineSelection, setLineSelection] = React.useState<LineRange | null>(initialSelection);
  const result = useLineNumberDragSelection({
    lineSelection,
    setLineSelection,
    onClear: () => { clears += 1; },
    isMobile: false,
  });
  selection = lineSelection;
  drag = result;
  return (
    <CodeMirrorEditor
      value={DOC}
      onChange={() => {}}
      lineNumbersConfig={result.lineNumbersConfig}
      onViewReady={(ready) => { view = ready; }}
    />
  );
};

const render = async (initialSelection: LineRange | null = null) => {
  await act(async () => root.render(<Host initialSelection={initialSelection} />));
  const editor = view;
  if (!editor) throw new Error('editor did not mount');
  // happy-dom lays nothing out: give the scroller a box and a scroll position
  // that moves the document, as a browser would.
  const lineHeight = editor.defaultLineHeight;
  Object.defineProperty(editor.scrollDOM, 'getBoundingClientRect', {
    value: () => ({ top: 0, bottom: VISIBLE_LINES * lineHeight, left: 0, right: 400, width: 400, height: VISIBLE_LINES * lineHeight }),
  });
  Object.defineProperty(editor.scrollDOM, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => { scrollTop = Math.max(0, Math.min(value, 90 * lineHeight)); },
  });
  Object.defineProperty(editor, 'documentTop', { get: () => -scrollTop });
  return editor;
};

// Page y of the middle of a line while the editor is scrolled to the top.
const lineY = (editor: InstanceType<typeof EditorView>, line: number) => (line - 0.5) * editor.defaultLineHeight;

const pressLineNumber = async (editor: InstanceType<typeof EditorView>, line: number, init: { shiftKey?: boolean } = {}) => {
  const gutter = editor.dom.querySelector('.cm-gutter.cm-lineNumbers');
  if (!gutter) throw new Error('no line-number gutter');
  await act(async () => {
    gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientY: lineY(editor, line), ...init }));
  });
};

const moveTo = async (clientX: number, clientY: number) => {
  await act(async () => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, buttons: 1 }));
  });
};

const release = async () => {
  await act(async () => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  });
};

beforeEach(() => {
  view = null;
  selection = null;
  drag = null;
  clears = 0;
  scrollTop = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
afterAll(() => dom.happyDOM.close());

describe('useLineNumberDragSelection', () => {
  test('keeps following the pointer after it drifts off the line numbers', async () => {
    const editor = await render();
    await pressLineNumber(editor, 3);
    expect(selection).toEqual({ start: 3, end: 3 });
    expect(drag?.isDragging).toBe(true);

    // Far to the right, over the code, and then outside the editor's width.
    await moveTo(300, lineY(editor, 6));
    expect(selection).toEqual({ start: 3, end: 6 });
    await moveTo(900, lineY(editor, 9));
    expect(selection).toEqual({ start: 3, end: 9 });
    await moveTo(900, lineY(editor, 1));
    expect(selection).toEqual({ start: 1, end: 3 });

    await release();
    expect(drag?.isDragging).toBe(false);
    await moveTo(300, lineY(editor, 7));
    expect(selection).toEqual({ start: 1, end: 3 });
  });

  test('marks only the click that ends a drag', async () => {
    const editor = await render();
    expect(drag?.isDragReleaseClick()).toBe(false);
    await pressLineNumber(editor, 2);
    await moveTo(300, lineY(editor, 5));
    await release();
    expect(drag?.isDragReleaseClick()).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(drag?.isDragReleaseClick()).toBe(false);
  });

  test('scrolls while the pointer is held below the editor and extends to the lines it reveals', async () => {
    const editor = await render();
    await pressLineNumber(editor, 4);
    await moveTo(20, VISIBLE_LINES * editor.defaultLineHeight + 40);
    expect(selection).toEqual({ start: 4, end: VISIBLE_LINES });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(scrollTop).toBeGreaterThan(0);
    const end = selection?.end ?? 0;
    expect(end).toBeGreaterThan(VISIBLE_LINES);
    expect(end).toBe(Math.floor((scrollTop + VISIBLE_LINES * editor.defaultLineHeight - 1) / editor.defaultLineHeight) + 1);

    await release();
    const stoppedAt = scrollTop;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(scrollTop).toBe(stoppedAt);
  });

  test('a click that wobbles on the last visible line neither scrolls nor grows the range', async () => {
    const editor = await render();
    await pressLineNumber(editor, VISIBLE_LINES);
    await moveTo(21, lineY(editor, VISIBLE_LINES) + 1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await release();
    expect(scrollTop).toBe(0);
    expect(selection).toEqual({ start: VISIBLE_LINES, end: VISIBLE_LINES });
  });

  test('ends the drag when the button is found released without a mouseup', async () => {
    const editor = await render();
    await pressLineNumber(editor, 2);
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: lineY(editor, 6), buttons: 0 }));
    });
    expect(drag?.isDragging).toBe(false);
    expect(selection).toEqual({ start: 2, end: 2 });
  });

  test('shift+click extends the selection; a click on the only selected line clears it', async () => {
    const editor = await render({ start: 5, end: 5 });
    await pressLineNumber(editor, 9, { shiftKey: true });
    await release();
    expect(selection).toEqual({ start: 5, end: 9 });

    await pressLineNumber(editor, 7);
    await release();
    expect(selection).toEqual({ start: 7, end: 7 });
    await pressLineNumber(editor, 7);
    expect(selection).toBeNull();
    expect(clears).toBe(1);
    expect(drag?.isDragging).toBe(false);
  });

  test('keeps the gutter config across renders', async () => {
    const editor = await render();
    const config = drag?.lineNumbersConfig;
    await pressLineNumber(editor, 3);
    await moveTo(20, lineY(editor, 6));
    await release();
    expect(drag?.lineNumbersConfig).toBe(config);
  });
});
