import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { createMappablePosition } from "@tiptap/extension-collaboration";
import { ProsemirrorBinding, relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { z } from "zod";
import { canEditDocument, type AiAction, type AiCreateRequest, type AiSuggestion, type Role } from "@typesync/shared";
import { useAiSuggestions } from "../lib/hooks/useAiSuggestions";
import { isTextOnlySelection, selectedText, unsafeAiSelectionReason } from "@typesync/shared/editor-schema";

const actions: { value: AiAction; label: string }[] = [
  { value: "rewrite", label: "Rewrite" },
  { value: "shorten", label: "Shorten" },
  { value: "grammar", label: "Fix grammar" },
  { value: "custom", label: "Custom" },
];
type Selection = Pick<AiCreateRequest, "sourceText" | "from" | "to">;
type CapturedSelection = { kind: "safe"; selection: Selection } | { kind: "unsafe" };
const CollaborationBindingSchema = z.object({ type: z.instanceof(Y.XmlFragment), binding: z.instanceof(ProsemirrorBinding) });
const buttonClass = "rounded-md border border-border px-3 py-2 text-ui font-medium text-text-primary hover:bg-bg-hover disabled:opacity-45 disabled:cursor-not-allowed transition-colors";

interface AiCoEditorProps {
  documentId: string;
  editor: Editor | null;
  ydoc: Y.Doc;
  role: Role;
  syncReady: boolean;
  children: ReactNode;
}

export function AiCoEditor({ documentId, editor, ydoc, role, syncReady, children }: AiCoEditorProps) {
  const [open, setOpen] = useState(false);
  const [capturedSelection, setCapturedSelection] = useState<CapturedSelection | null>(null);
  const selection = capturedSelection?.kind === "safe" ? capturedSelection.selection : null;
  const [instruction, setInstruction] = useState("");
  const [action, setAction] = useState<AiAction>("rewrite");
  const [request, setRequest] = useState<AiCreateRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const mounted = useRef(true);
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const { suggestions, configured, error, connected, refresh, create, resolveSuggestion } = useAiSuggestions(documentId, syncReady);
  const canEdit = canEditDocument(role);
  const pendingCount = suggestions.filter(item => item.status === "ready" || item.status === "streaming").length;
  const ready = syncReady && connected;
  const disabledReason = !canEdit ? "Viewers can see suggestions. An editor or owner can request and review them."
    : !ready ? "Waiting for the document to sync. AI actions need a live connection."
    : configured === false ? "AI is not configured on this server."
    : configured === null ? "Loading AI availability…"
    : capturedSelection?.kind === "unsafe" ? unsafeAiSelectionReason
    : !selection ? "Select text in the document to ask AI."
    : selection.sourceText.length > 12000 ? "Select no more than 12,000 characters."
    : action === "custom" && !instruction.trim() ? "Write an instruction for the AI."
    : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const close = () => {
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!editor) return;
    const capture = () => {
      if (editor.isDestroyed) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        if (editor.isFocused) setCapturedSelection(null);
        return;
      }
      if (!isTextOnlySelection(editor.state.doc, from, to)) {
        setCapturedSelection({ kind: "unsafe" });
        setRequest(null);
        return;
      }
      const sourceText = selectedText(editor.state.doc, from, to);
      if (!sourceText.trim()) return setCapturedSelection(null);
      try {
        const fromAnchor = createMappablePosition(from, editor.state).yRelativePosition;
        const toAnchor = createMappablePosition(to, editor.state).yRelativePosition;
        if (!fromAnchor || !toAnchor) return setCapturedSelection(null);
        setCapturedSelection({ kind: "safe", selection: { sourceText, from: Array.from(Y.encodeRelativePosition(fromAnchor)), to: Array.from(Y.encodeRelativePosition(toAnchor)) } });
      } catch {
        setCapturedSelection(null);
      }
    };
    editor.on("selectionUpdate", capture);
    editor.on("update", capture);
    editor.on("focus", capture);
    return () => {
      editor.off("selectionUpdate", capture);
      editor.off("update", capture);
      editor.off("focus", capture);
    };
  }, [editor, ydoc]);

  const submit = async (retry = false) => {
    if (busy || !canEdit || !ready || configured !== true) return;
    if (!retry && (disabledReason || !selection)) return;
    const next = retry ? request : selection ? {
      ...selection, requestId: crypto.randomUUID(), action, instruction: action === "custom" ? instruction.trim() : "",
    } : null;
    if (!next) return;
    setRequest(next);
    setBusy("create");
    setLocalError(null);
    const result = await create(next);
    if (!mounted.current) return;
    setBusy(null);
    if (!result.success) setLocalError(result.error);
    else setRequest(null);
  };

  const review = async (suggestion: AiSuggestion, decision: "accept" | "reject") => {
    if (!canEdit || !ready || busy) return;
    setBusy(suggestion.id);
    setLocalError(null);
    const result = await resolveSuggestion({ suggestionId: suggestion.id, decision });
    if (!mounted.current) return;
    setBusy(null);
    if (!result.success) setLocalError(result.error);
  };

  const locate = (suggestion: AiSuggestion) => {
    if (!editor || editor.isDestroyed) return;
    try {
      const binding = CollaborationBindingSchema.safeParse(ySyncPluginKey.getState(editor.state));
      if (!binding.success) return;
      const from = relativePositionToAbsolutePosition(ydoc, binding.data.type, Y.decodeRelativePosition(Uint8Array.from(suggestion.from)), binding.data.binding.mapping);
      const to = relativePositionToAbsolutePosition(ydoc, binding.data.type, Y.decodeRelativePosition(Uint8Array.from(suggestion.to)), binding.data.binding.mapping);
      if (from === null || to === null || from < 1 || to <= from || to > editor.state.doc.content.size || selectedText(editor.state.doc, from, to) !== suggestion.sourceText) {
        setLocalError("The source text has changed or was removed. This suggestion cannot safely replace it. Select the current text and ask AI again.");
        return;
      }
      editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
      if (window.innerWidth < 768) setOpen(false);
    } catch {
      setLocalError("The original text is no longer available. Select the current text and ask AI again.");
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border bg-bg-elevated px-4 py-2">
        <span className="hidden sm:inline text-ui text-text-muted">{canEdit ? "Select text to rewrite, shorten, or fix grammar." : "AI suggestions are visible to every collaborator."}</span>
        <button ref={toggle} type="button" aria-expanded={open} aria-controls={`ai-panel-${documentId}`} aria-keyshortcuts="Alt+Shift+A" title="AI co-editor (Alt+Shift+A)" onClick={() => setOpen(value => !value)} className={`${buttonClass} whitespace-nowrap ${open ? "bg-accent-light text-accent" : ""}`}>
          <span aria-hidden="true">✦ </span>{canEdit ? "AI co-editor" : "AI suggestions"}{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </button>
      </div>
      <div className="relative flex flex-1 min-h-0">
      {children}
      {open && (
        <aside ref={panel} tabIndex={-1} id={`ai-panel-${documentId}`} aria-label="AI co-editor" onKeyDown={event => { if (event.key === "Escape") close(); }} className="absolute md:static z-30 right-0 top-0 bottom-0 w-full md:w-96 shrink-0 bg-bg-elevated border-l border-border shadow-xl md:shadow-none flex flex-col outline-none">
          <div className="shrink-0 flex items-center justify-between border-b border-border p-4">
            <div><h2 className="text-base font-semibold text-text-primary">AI co-editor</h2><p className="text-ui text-text-muted mt-1">Suggestions stay separate until accepted.</p></div>
            <button type="button" className={buttonClass} aria-label="Close AI co-editor" onClick={close}>✕</button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
            {canEdit && (
              <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3">
                <p className="block text-ui font-medium text-text-secondary">Selected text</p>
                <div className="rounded-md border border-border bg-bg-secondary p-3 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-ui text-text-secondary">{selection?.sourceText ?? "Select a passage in the document, then choose an action below."}</div>
                {selection && <p className="text-micro text-text-muted">{selection.sourceText.length.toLocaleString()} / 12,000 characters</p>}
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="AI action">
                  {actions.map(item => <button key={item.value} type="button" disabled={busy === "create"} aria-pressed={action === item.value} className={`${buttonClass} ${action === item.value ? "bg-accent-light border-border-accent text-accent" : ""}`} onClick={() => { setAction(item.value); setRequest(null); }}>{item.label}</button>)}
                </div>
                {action === "custom" && <div><label htmlFor={`ai-instruction-${documentId}`} className="block text-ui font-medium text-text-secondary mb-2">Your instruction</label><textarea id={`ai-instruction-${documentId}`} disabled={busy === "create"} maxLength={2000} rows={3} value={instruction} placeholder="For example, make this warmer and more direct." onChange={event => { setInstruction(event.target.value); setRequest(null); }} className="w-full rounded-md border border-border bg-bg-secondary p-3 text-ui text-text-primary focus:outline-none focus:border-accent" /><p className="text-micro text-text-muted text-right">{instruction.length} / 2,000</p></div>}
                <button type="submit" disabled={Boolean(disabledReason) || busy !== null} title={disabledReason ?? undefined} className={`${buttonClass} w-full bg-accent text-white border-accent hover:opacity-90`}>{busy === "create" ? "Requesting suggestion…" : "Generate suggestion"}</button>
                {disabledReason && <p className="text-ui text-text-muted">{disabledReason}</p>}
              </form>
            )}
            {!canEdit && <p className="text-ui text-text-muted">Viewers can follow suggestions live. Editors and owners can request, accept, or reject them.</p>}
            {(localError || error) && <div role="alert" className="rounded-md border border-border-accent bg-accent-light p-3 text-ui text-text-primary"><p>{localError ?? error}</p><div className="flex gap-2 mt-2"><button type="button" className={buttonClass} disabled={!ready} onClick={() => { setLocalError(null); refresh(); }}>Refresh suggestions</button>{request && <button type="button" className={buttonClass} disabled={!ready || Boolean(busy)} onClick={() => { void submit(true); }}>Retry request</button>}</div></div>}
            <div className="flex items-center justify-between"><h3 className="text-ui font-semibold text-text-primary">Suggestions ({suggestions.length})</h3><button type="button" className="text-ui text-text-muted hover:text-text-primary disabled:opacity-45" disabled={!ready} onClick={refresh} aria-label="Refresh AI suggestions">Refresh</button></div>
            {suggestions.length === 0 && <p className="text-ui text-text-muted">{ready ? "No suggestions yet. Suggestions from every collaborator will appear here." : "Connect to load the latest suggestions."}</p>}
            {suggestions.map(suggestion => (
              <article key={suggestion.id} className="rounded-lg border border-border overflow-hidden" aria-label={`${actions.find(item => item.value === suggestion.action)?.label ?? suggestion.action} suggestion by ${suggestion.authorName}`}>
                <div className="px-3 py-2 bg-bg-secondary flex justify-between gap-2 text-ui"><span className="font-medium text-text-primary">{actions.find(item => item.value === suggestion.action)?.label}</span><span className="text-text-muted capitalize">{suggestion.status === "streaming" ? "Writing…" : suggestion.status}</span></div>
                <div className="p-3 space-y-3">
                  <p className="text-micro text-text-muted">Requested by {suggestion.authorName}</p>
                  {suggestion.instruction && <p className="text-ui text-text-secondary whitespace-pre-wrap break-words">{suggestion.instruction}</p>}
                  <details><summary className="text-ui text-text-muted cursor-pointer">Original text</summary><p className="mt-2 text-ui text-text-secondary whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{suggestion.sourceText}</p></details>
                  <div className="text-ui text-text-primary whitespace-pre-wrap break-words max-h-80 overflow-y-auto" aria-label="Suggested text">{suggestion.replacement || (suggestion.status === "streaming" ? "Waiting for AI…" : "No replacement text.")}</div>
                  {suggestion.status === "failed" && <p className="text-ui text-accent" role="alert">{suggestion.error}</p>}
                  {(suggestion.status === "accepted" || suggestion.status === "rejected") && <p className="text-micro text-text-muted">{suggestion.status === "accepted" ? "Accepted" : "Rejected"} by {suggestion.resolvedBy}</p>}
                  {suggestion.model && <p className="text-micro text-text-muted break-all">Model used · {suggestion.model}</p>}
                  {(suggestion.status === "ready" || suggestion.status === "streaming") && <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!ready} onClick={() => locate(suggestion)}>Locate source</button>{canEdit && <><button type="button" className={`${buttonClass} bg-accent-light text-accent`} disabled={!ready || busy !== null || suggestion.status !== "ready"} title={suggestion.status === "streaming" ? "Wait for the suggestion to finish." : !ready ? "Wait for the document to sync." : "Replace the original text with this suggestion."} onClick={() => { void review(suggestion, "accept"); }}>{busy === suggestion.id ? "Updating…" : "Accept"}</button><button type="button" className={buttonClass} disabled={!ready || busy !== null} onClick={() => { void review(suggestion, "reject"); }}>Reject</button></>}</div>}
                </div>
              </article>
            ))}
            {pendingCount > 0 && <p role="status" className="sr-only">{pendingCount} AI suggestions await review.</p>}
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}
