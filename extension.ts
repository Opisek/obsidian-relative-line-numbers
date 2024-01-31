import { Extension } from "@codemirror/state";
import { EditorView, ViewUpdate, gutter, lineNumbers, GutterMarker } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import {foldedRanges} from "@codemirror/language"

let relativeLineNumberGutter = new Compartment();

let counter : number;
let selectionTo: number;
const lineStates: { [key: string]: { lastLine: number, cursorLine: number, skip: boolean, mapping: { [key: number]: number } } } = {};

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

function relativeLineNumbers(lineNo: number, state: EditorState) {
  if (lineNo == 999) return;

  //const path = ((state as any).values[1].file.path) as string;
  const path = "test";

  let currentLineState = path in lineStates ? lineStates[path] : null;

  if (currentLineState == null || currentLineState.lastLine >= lineNo) {
    selectionTo = state.selection.asSingle().ranges[0].to;
    const newCursorLine = state.doc.lineAt(selectionTo).number;

    if (currentLineState != null && currentLineState.cursorLine == newCursorLine) {
      lineStates[path] = {
        lastLine: lineNo,
        cursorLine: newCursorLine,
        skip: true,
        mapping: currentLineState.mapping
      }
    } else {
      currentLineState = {
        lastLine: lineNo,
        cursorLine: newCursorLine,
        skip: false,
        mapping: {}
      };

      lineStates[path] = currentLineState;
      counter = lineNo - newCursorLine;
    }
  }

  const charLength = linesCharLength(state);
  const blank = " ".padStart(charLength, " ");
  if (lineNo > state.doc.lines) {
    return blank;
  }

  if (lineStates[path].skip)
    return lineNo in currentLineState.mapping && currentLineState.mapping[lineNo] != 0
      ? Math.abs(currentLineState.mapping[lineNo]).toString().padStart(charLength, " ")
      : blank;
  lineStates[path].lastLine = lineNo;

  //const selectionFrom = state.doc.line(lineNo).from;

  //let start, stop;
  //if (selectionTo > selectionFrom) {
  //  start = selectionFrom;
  //  selectionTo = selectionTo;
  //} else {
  //  start = selectionTo;
  //  selectionTo = selectionFrom;
  //}

  //const folds = foldedRanges(state)
  //let foldedCount = 0
  //folds.between(start, stop, (from, to) => {
  //  let rangeStart = state.doc.lineAt(from).number
  //  let rangeStop = state.doc.lineAt(to).number
  //  foldedCount += rangeStop - rangeStart
  //})
  
  const foldedCount = 0;

  const myCounter = counter;
  lineStates[path].mapping[lineNo] = counter++;

  return myCounter != 0
    ? Math.abs(myCounter).toString().padStart(charLength, " ")
    : blank;
}

// This shows the numbers in the gutter
const showLineNumbers = relativeLineNumberGutter.of(
  lineNumbers({ formatNumber: relativeLineNumbers })
);

// This ensures the numbers update
// when selection (cursorActivity) happens
const lineNumbersUpdateListener = EditorView.updateListener.of(
  (viewUpdate: ViewUpdate) => {
    if (viewUpdate.selectionSet) {
      viewUpdate.view.dispatch({
        effects: relativeLineNumberGutter.reconfigure(
          lineNumbers({ formatNumber: relativeLineNumbers })
        ),
      });
    }
  }
);

export function lineNumbersRelative(): Extension {
  return [absoluteLineNumberGutter, showLineNumbers, lineNumbersUpdateListener];
}
