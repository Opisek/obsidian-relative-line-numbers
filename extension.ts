import { Extension } from "@codemirror/state";
import { EditorView, ViewUpdate, gutter, lineNumbers, GutterMarker } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import {foldedRanges} from "@codemirror/language"

let relativeLineNumberGutter = new Compartment();
let cursorLine: number = -1;
let selectionTo: number = -1;
let charLength: number = 0;
let blank: string = "";

let lastUpdate: number = 0

const lastUpdateForLine = new Map<number, string>();
const lastNumberForLine = new Map<number, string>();

let linesUpdated = new Set<number>();

class Marker extends GutterMarker {
  /** The text to render in gutter */
  text: string;

  constructor(text: string) {
    super();
    this.text = text;
    this.elementClass = "relative-line-numbers-mono";
  }

  toDOM() {
    return document.createTextNode(this.text);
  }
}

function linesCharLength(state: EditorState): number {
  /**
   * Get the character length of the number of lines in the document
   * Example: 100 lines -> 3 characters
   */
  return state.doc.lines.toString().length;
}

const absoluteLineNumberGutter = gutter({
  lineMarker: (view, line) => {
    const lineNo = view.state.doc.lineAt(line.from).number;
    const charLength = linesCharLength(view.state);
    const absoluteLineNo = new Marker(lineNo.toString().padStart(charLength, " "));
    const cursorLine = view.state.doc.lineAt(
      view.state.selection.asSingle().ranges[0].to
    ).number;

    if (lineNo === cursorLine) {
      return absoluteLineNo;
    }

    return null;
  },
  initialSpacer: (view: EditorView) => {
    const spacer = new Marker("0".repeat(linesCharLength(view.state)));
    return spacer;
  },
});

function curryRelativeLineNumbers(updateTime: number) {
  return (lineNo: number, state: EditorState) => relativeLineNumbers(lineNo, state, updateTime);
}

function relativeLineNumbers(lineNo: number, state: EditorState, updateTime: number) {
  // Ignore the first line update, since two are always triggered.
  const currentUpdateIdentificator = createUpdateIdentificator(state);
  if (!lastUpdateForLine.has(lineNo) || lastUpdateForLine.get(lineNo) != currentUpdateIdentificator) {
    lastUpdateForLine.set(lineNo, currentUpdateIdentificator);
    return lastNumberForLine.get(lineNo) || blank;
  }

  // Do not act on old updates
  if (updateTime < lastUpdate) {
    return lastNumberForLine.get(lineNo) || blank;
  }

  // Blank if out of range or current line
  if (lineNo > state.doc.lines || lineNo == cursorLine) {
    lastNumberForLine.set(lineNo, blank);
    return blank;
  }

  if (selectionTo == -1) {
    selectionTo = state.selection.asSingle().ranges[0].to;
  }
  const selectionFrom = state.doc.line(lineNo).from;

  // Determine the scope of the line numbers
  let start, stop;
  if (selectionTo > selectionFrom) {
    start = selectionFrom;
    selectionTo = selectionTo;
  } else {
    start = selectionTo;
    selectionTo = selectionFrom;
  }

  // Count the number of lines that are folded between the start and stop
  const folds = foldedRanges(state)
  let foldedCount = 0
  folds.between(start, stop, (from, to) => {
    let rangeStart = state.doc.lineAt(from).number
    let rangeStop = state.doc.lineAt(to).number
    foldedCount += rangeStop - rangeStart
  })

  const lineNumberResult = (Math.abs(cursorLine - lineNo) - foldedCount).toString().padStart(charLength, " ");
  lastNumberForLine.set(lineNo, lineNumberResult);
  return lineNumberResult;
}

// This shows the numbers in the gutter
const showLineNumbers = relativeLineNumberGutter.of(
  lineNumbers({ formatNumber: curryRelativeLineNumbers(0) })
);

function createUpdateIdentificator(state: EditorState): string {
  return [
    JSON.stringify(state.selection.toJSON(), null, 2),
    state.doc.length
  ].join('-');
}

// This ensures the numbers update
// when selection (cursorActivity) happens
const lineNumbersUpdateListener = EditorView.updateListener.of(
  (viewUpdate: ViewUpdate) => {
    if (viewUpdate.selectionSet) {
      const currentTime = (new Date()).getMilliseconds();
      lastUpdate = currentTime;
      linesUpdated = new Set<number>();

      const state = viewUpdate.state;

      charLength = linesCharLength(state);
      blank = " ".padStart(charLength, " ");

      selectionTo = state.selection.asSingle().ranges[0].to;
      const newCursorLine = state.doc.lineAt(selectionTo).number;

      // If we have not changed the line, do not update the line numbers.
      if (newCursorLine == cursorLine) return;
      cursorLine = newCursorLine;

      // We add a delay to dispatching updates to avoid issuing updates too
      // often, like when scrolling or holding down movement keys.
      // If this is not done, then the rendering thread is slowed down resulting
      // in visible lag.
      // 
      // TODO: consider making the delay adaptive. It should increase if the
      // updates are cancelled most of the time and decrease if they are not.
      setTimeout(() => { 
        // Don't act on old updates
        if (currentTime != lastUpdate) {
          return;
        }
        viewUpdate.view.dispatch({
          effects: relativeLineNumberGutter.reconfigure(
            lineNumbers({ formatNumber: curryRelativeLineNumbers(currentTime) })
          ),
        });
      }, 50);
    }
  }
);

export function lineNumbersRelative(): Extension {
  return [absoluteLineNumberGutter, showLineNumbers, lineNumbersUpdateListener];
}
