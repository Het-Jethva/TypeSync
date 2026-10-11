import * as Y from "yjs";

export const aiAcceptanceOrigin = Symbol("ai-acceptance");

export function applyAiAcceptance(ydoc: Y.Doc, update: Uint8Array, undoManager: Y.UndoManager) {
  undoManager.stopCapturing();
  try {
    Y.applyUpdate(ydoc, update, aiAcceptanceOrigin);
  } finally {
    undoManager.stopCapturing();
  }
}
