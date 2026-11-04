const MAX_SIZE = 100;
let undoStack = [];
let redoStack = [];

export function pushState(snapshot) {
  undoStack.push(JSON.stringify(snapshot));
  if (undoStack.length > MAX_SIZE) undoStack.shift();
  redoStack = [];
}

export function undo(currentSnapshot) {
  if (undoStack.length === 0) return null;
  redoStack.push(JSON.stringify(currentSnapshot));
  return JSON.parse(undoStack.pop());
}

export function redo(currentSnapshot) {
  if (redoStack.length === 0) return null;
  undoStack.push(JSON.stringify(currentSnapshot));
  return JSON.parse(redoStack.pop());
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export function clear() {
  undoStack = [];
  redoStack = [];
}
