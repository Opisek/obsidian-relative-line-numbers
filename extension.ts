import { Extension } from "@codemirror/state";
import { EditorView, ViewUpdate, gutter, lineNumbers, GutterMarker } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import {foldedRanges} from "@codemirror/language"

// Adjustable timing parameters
const minimumDispatchTime = 50;
const maximumDispatchTime = 500;

// Calculation
let relativeLineNumberGutter = new Compartment();
let cursorLine: number = -1;
let selectionTo: number = -1;
let charLength: number = 0;
let blank: string = "";

// Cache
const lastLineResult = new Map<number, string>();

// Dispatching and double update prevention
let lastUpdateIdentificator: string = "";
let lastUpdate: number = 0
let lastDispatchedUpdate: number = 0;

let lastCursorUpdate: number = 0;
let lastSurpressedUpdate: number = 0;

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
  // Do not act on old updates
  if (updateTime < lastUpdate) return lastLineResult.get(lineNo) || blank;

  // Make sure the cursor is up-to-date even if no update has been dispatched.
  const currentTime = Date.now();
  if (lastSurpressedUpdate > lastCursorUpdate) {
    lastCursorUpdate = currentTime; 
    selectionTo = state.selection.asSingle().ranges[0].to;
    cursorLine = state.doc.lineAt(selectionTo).number;
  }

  // Blank if out of range or current line
  if (lineNo > state.doc.lines || lineNo == cursorLine) {
    lastLineResult.set(lineNo, blank);
    return blank;
  }

  // Determine the scope of the line numbers
  if (selectionTo == -1) {
    selectionTo = state.selection.asSingle().ranges[0].to;
  }
  const selectionFrom = state.doc.line(lineNo).from;

  let start, stop;
  if (selectionTo > selectionFrom) {
    start = selectionFrom;
    selectionTo = selectionTo;
  } else {
    start = selectionTo;
    selectionTo = selectionFrom;
  }

  // Count the number of lines that are folded between the start and stop
  // TODO: perhaps use a data structures that offers better access times like a sparse table
  const folds = foldedRanges(state)
  let foldedCount = 0
  folds.between(start, stop, (from, to) => {
    let rangeStart = state.doc.lineAt(from).number
    let rangeStop = state.doc.lineAt(to).number
    foldedCount += rangeStop - rangeStart
  })

  // Finazile the result
  const lineNumberResult = (Math.abs(cursorLine - lineNo) - foldedCount).toString().padStart(charLength, " ");
  lastLineResult.set(lineNo, lineNumberResult);
  return lineNumberResult;
}

// This shows the numbers in the gutter on startup.
const showLineNumbers = relativeLineNumberGutter.of(
  lineNumbers({ formatNumber: curryRelativeLineNumbers(0) })
);

// Used to recognize duplicate updates
function createUpdateIdentificator(state: EditorState): string {
  return [
    JSON.stringify(state.selection.toJSON(), null, 2),
    state.doc.length
  ].join('-');
}

// Update rate limiting
function dispatchUpdate(currentTime: number, viewUpdate: ViewUpdate) {
  lastDispatchedUpdate = currentTime;
  viewUpdate.view.dispatch({
    effects: relativeLineNumberGutter.reconfigure(
      lineNumbers({ formatNumber: curryRelativeLineNumbers(currentTime) })
    ),
  });
}

// This ensures the numbers update
// when selection (cursorActivity) happens
const lineNumbersUpdateListener = EditorView.updateListener.of(
  (viewUpdate: ViewUpdate) => {
    if (viewUpdate.selectionSet) {
      // Position calculations
      const state = viewUpdate.state;
      charLength = linesCharLength(state);
      blank = " ".padStart(charLength, " ");
      selectionTo = state.selection.asSingle().ranges[0].to;
      const newCursorLine = state.doc.lineAt(selectionTo).number;

      // If we have not changed the line, do not update the line numbers.
      if (newCursorLine == cursorLine) return;
      const currentTime = Date.now();
      lastCursorUpdate = currentTime; 
      cursorLine = newCursorLine;

      // Prevent double updates
      const updateIdentificator = createUpdateIdentificator(state);
      if (updateIdentificator == lastUpdateIdentificator) return;
      lastUpdateIdentificator = updateIdentificator;

      // If there have not been any scheduled updates for some time, we dispatch
      // the update instantly to reduce perceivable waittime. Should the
      // following call happen soon, then we prepare for a burst of updates and
      // add the delay. An exception is made when there has not been an update
      // for a long time, so the user can see some incremental changes.
      const dispatchInstantly = currentTime - lastUpdate >= 2 * minimumDispatchTime || currentTime - lastDispatchedUpdate > maximumDispatchTime;
      lastUpdate = currentTime;

      if (dispatchInstantly) {  
        dispatchUpdate(currentTime, viewUpdate);
      } else {
        // We add a delay to dispatching updates to avoid issuing updates too
        // often, like when scrolling or holding down movement keys.
        // If this is not done, then the rendering thread is slowed down resulting
        // in visible lag.
        setTimeout(() => {
          // If a newer update has been queued, cancel this update.
          if (currentTime == lastUpdate) dispatchUpdate(currentTime, viewUpdate);
        }, minimumDispatchTime);
      }
    } else {
      lastSurpressedUpdate = Date.now();
    }
  }
);

export function lineNumbersRelative(): Extension {
  return [absoluteLineNumberGutter, showLineNumbers, lineNumbersUpdateListener];
}
