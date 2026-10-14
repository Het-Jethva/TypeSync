import { createHash, randomUUID } from "node:crypto";
import * as Y from "yjs";
import { z } from "zod";
import { Fragment, type Mark } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { absolutePositionToRelativePosition, initProseMirrorDoc, relativePositionToAbsolutePosition, updateYFragment } from "@tiptap/y-tiptap";
import { editorSchema, isTextOnlySelection, selectedText, unsafeAiSelectionReason } from "@typesync/shared/editor-schema";
import { AiSuggestionSchema, PostgresTextSchema, type AiCreateRequest, type AiResolveRequest, type AiResult, type AiListResult, type AiSuggestion } from "@typesync/shared";
import type { CollaborativeRoomSession } from "../socket/room-session.js";
import type { DocumentStateRepository } from "../socket/repository.js";
import type { TypeSyncSocket } from "../socket/types.js";
import { streamEdit, isAiConfigured } from "./openrouter.js";

const EntrySchema = z.object({ suggestion: AiSuggestionSchema, sourceSlice: z.string(), sourceIdentity: z.string() });
type Entry = z.infer<typeof EntrySchema>;
type Provider = typeof streamEdit;

class UnsafeAiSelectionError extends Error {
  constructor() { super(unsafeAiSelectionReason); }
}

export class AiSuggestionService {
  private readonly histories = new Map<string, Entry[]>();
  private readonly loads = new Map<string, Promise<Entry[]>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly dirtyHistories = new Map<string, number>();
  private historyRevision = 0;
  private readonly active = new Map<string, { documentId: string; controller: AbortController; entry: Entry }>();
  private readonly creates = new Map<string, { documentId: string; authorId: string; result: Promise<AiResult> }>();
  private readonly lastRequests = new Map<string, number>();
  private readonly deleted = new Set<string>();
  private readonly pendingAcceptances = new Map<string, { suggestion: AiSuggestion; epoch: string; revision: number }>();
  private readonly historyRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly acceptanceFlushes = new Map<string, number>();

  constructor(private readonly options: {
    rooms: CollaborativeRoomSession;
    repository: DocumentStateRepository;
    emit: (documentId: string, suggestion: AiSuggestion) => void;
    emitUpdate: (documentId: string, update: Uint8Array, socketId: string, cursor: { epoch: string; revision: number }) => void;
    provider?: Provider;
    configured?: () => boolean;
  }) {
    options.rooms.onAiFlush(() => this.flush());
    options.rooms.onDocumentSaved(({ documentId, epoch, revision }) => {
      if (this.acceptanceFlushes.has(documentId)) return;
      let finalized = false;
      for (const [id, acceptance] of this.pendingAcceptances) {
        if (acceptance.suggestion.documentId === documentId && acceptance.epoch === epoch && acceptance.revision <= revision) {
          this.pendingAcceptances.delete(id);
          finalized = true;
        }
      }
      if (finalized) void this.persist(documentId).catch(() => {});
    });
    options.rooms.onAiLifecycle(documentId => {
      for (const [id, run] of this.active) {
        if (documentId === null || documentId === run.documentId) {
          run.controller.abort();
          this.active.delete(id);
          if (documentId === null) {
            const entry = run.entry;
            if (entry.suggestion.status === "streaming") {
              entry.suggestion = { ...entry.suggestion, status: "failed", error: "Generation interrupted by server shutdown. Try again." };
              if (this.histories.get(run.documentId)?.includes(entry)) {
                this.changed(entry);
                void this.persist(run.documentId).catch(() => {});
              }
            }
          }
        }
      }
      if (documentId !== null) {
        this.deleted.add(documentId);
        this.histories.delete(documentId);
        this.dirtyHistories.delete(documentId);
        const retryTimer = this.historyRetryTimers.get(documentId);
        if (retryTimer) clearTimeout(retryTimer);
        this.historyRetryTimers.delete(documentId);
        for (const [id, acceptance] of this.pendingAcceptances) {
          if (acceptance.suggestion.documentId === documentId) this.pendingAcceptances.delete(id);
        }
        const cleanup = setTimeout(() => this.deleted.delete(documentId), 300_000);
        cleanup.unref();
      }
    });
  }

  private async load(documentId: string): Promise<Entry[]> {
    const existing = this.histories.get(documentId);
    if (existing) return existing;
    const loading = this.loads.get(documentId);
    if (loading) return loading;
    const operation = (async () => {
      const raw = await this.options.repository.loadAiSuggestions?.(documentId) ?? [];
      if (this.deleted.has(documentId)) throw new Error("Document no longer exists");
      const entries = z.array(EntrySchema).max(100).parse(raw);
      let interrupted = false;
      for (const entry of entries) {
        if (entry.suggestion.status === "streaming") {
          entry.suggestion = { ...entry.suggestion, status: "failed", error: "Generation interrupted. Select the text and try again.",
            updatedAt: new Date(Math.max(Date.now(), Date.parse(entry.suggestion.updatedAt) + 1)).toISOString() };
          interrupted = true;
        }
      }
      if (this.histories.size >= 64) {
        for (const [id] of this.histories) {
          if (!this.writes.has(id) && !this.dirtyHistories.has(id) && ![...this.creates.values()].some(run => run.documentId === id) && ![...this.active.values()].some(run => run.documentId === id) &&
            ![...this.pendingAcceptances.values()].some(acceptance => acceptance.suggestion.documentId === id)) {
            this.histories.delete(id);
            break;
          }
        }
      }
      this.histories.set(documentId, entries);
      if (interrupted) await this.persist(documentId);
      return entries;
    })();
    this.loads.set(documentId, operation);
    try { return await operation; } finally { this.loads.delete(documentId); }
  }

  private persist(documentId: string, newEntry?: Entry): Promise<void> {
    if (this.deleted.has(documentId)) return Promise.resolve();
    const revision = ++this.historyRevision;
    this.dirtyHistories.set(documentId, revision);
    const previous = this.writes.get(documentId) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      if (!this.deleted.has(documentId)) {
        const entries = this.histories.get(documentId) ?? [];
        const next = [...entries];
        if (newEntry) {
          if (next.length >= 100) {
            const oldest = next.findIndex(entry => !["streaming", "ready"].includes(entry.suggestion.status));
            if (oldest < 0) throw new Error("Resolve existing suggestions before creating more");
            next.splice(oldest, 1);
          }
          next.push(newEntry);
        }
        const snapshot = structuredClone(next.map(entry => ({
          ...entry, suggestion: this.pendingAcceptances.get(entry.suggestion.id)?.suggestion ?? entry.suggestion,
        })));
        await this.options.repository.saveAiSuggestions?.(documentId, snapshot);
        if (this.deleted.has(documentId)) return;
        if (newEntry) entries.splice(0, entries.length, ...next);
        if (this.dirtyHistories.get(documentId) === revision &&
          ![...this.pendingAcceptances.values()].some(acceptance => acceptance.suggestion.documentId === documentId)) {
          this.dirtyHistories.delete(documentId);
        }
      }
    });
    this.writes.set(documentId, write);
    void write.catch(() => {
      if (this.deleted.has(documentId) || this.historyRetryTimers.has(documentId)) return;
      const timer = setTimeout(() => {
        this.historyRetryTimers.delete(documentId);
        if (this.dirtyHistories.has(documentId)) void this.persist(documentId).catch(() => {});
      }, 15_000);
      timer.unref();
      this.historyRetryTimers.set(documentId, timer);
    });
    void write.finally(() => { if (this.writes.get(documentId) === write) this.writes.delete(documentId); }).catch(() => {});
    return write;
  }

  private changed(entry: Entry): void {
    this.dirtyHistories.set(entry.suggestion.documentId, ++this.historyRevision);
    entry.suggestion.updatedAt = new Date(Math.max(Date.now(), Date.parse(entry.suggestion.updatedAt) + 1)).toISOString();
    this.options.emit(entry.suggestion.documentId, entry.suggestion);
  }

  private async flushAcceptance(documentId: string): Promise<void> {
    this.acceptanceFlushes.set(documentId, (this.acceptanceFlushes.get(documentId) ?? 0) + 1);
    try { await this.options.rooms.flushDocumentForAi(documentId); }
    finally {
      const remaining = (this.acceptanceFlushes.get(documentId) ?? 1) - 1;
      if (remaining) this.acceptanceFlushes.set(documentId, remaining);
      else this.acceptanceFlushes.delete(documentId);
    }
  }

  private selection(documentId: string, anchors: Pick<AiCreateRequest, "from" | "to">) {
    const clone = new Y.Doc();
    try {
      Y.applyUpdate(clone, this.options.rooms.snapshotForAi(documentId));
      const fragment = clone.getXmlFragment("default");
      const { doc, mapping } = initProseMirrorDoc(fragment, editorSchema);
      const startAnchor = Y.decodeRelativePosition(Uint8Array.from(anchors.from));
      const endAnchor = Y.decodeRelativePosition(Uint8Array.from(anchors.to));
      const start = Y.createAbsolutePositionFromRelativePosition(startAnchor, clone);
      const end = Y.createAbsolutePositionFromRelativePosition(endAnchor, clone);
      if (!start || !end) throw new Error("Selected text no longer exists");
      let startRoot = start.type;
      let endRoot = end.type;
      while (startRoot.parent) startRoot = startRoot.parent;
      while (endRoot.parent) endRoot = endRoot.parent;
      if (startRoot !== fragment || endRoot !== fragment) throw new Error("Selection must belong to the document");
      const from = relativePositionToAbsolutePosition(clone, fragment, startAnchor, mapping);
      const to = relativePositionToAbsolutePosition(clone, fragment, endAnchor, mapping);
      if (from === null || to === null || from < 0 || to <= from || to > doc.content.size) throw new Error("Invalid text selection");
      if (to - from > 24000) throw new Error("Selected range is too large");
      if (!isTextOnlySelection(doc, from, to)) throw new UnsafeAiSelectionError();
      const identity = createHash("sha256");
      for (let position = from; position <= to; position++) {
        identity.update(Y.encodeRelativePosition(absolutePositionToRelativePosition(position, fragment, mapping)));
      }
      return { clone, fragment, doc, mapping, from, to, text: selectedText(doc, from, to), slice: JSON.stringify(doc.slice(from, to).toJSON()), identity: identity.digest("hex") };
    } catch (error) { clone.destroy(); throw error; }
  }

  async list(socket: TypeSyncSocket, documentId: string): Promise<AiListResult> {
    try {
      const error = this.options.rooms.aiAccess(socket, documentId);
      if (error) return { success: false, error };
      const entries = await this.load(documentId);
      const currentError = this.options.rooms.aiAccess(socket, documentId);
      if (currentError) return { success: false, error: currentError };
      return { success: true, suggestions: entries.map(entry => entry.suggestion), configured: (this.options.configured ?? isAiConfigured)() };
    } catch { return { success: false, error: "Could not load AI suggestions" }; }
  }

  async create(socket: TypeSyncSocket, documentId: string, request: AiCreateRequest): Promise<AiResult> {
    const error = this.options.rooms.aiAccess(socket, documentId, true);
    if (error) return { success: false, error };
    const key = JSON.stringify([documentId, request.requestId]);
    const pending = this.creates.get(key);
    if (pending) {
      if (pending.authorId !== socket.data.userId) return { success: false, error: "Request id already used" };
      const result = await pending.result;
      const currentError = this.options.rooms.aiAccess(socket, documentId, true);
      return currentError ? { success: false, error: currentError } : result;
    }
    const result = this.createSuggestion(socket, documentId, request);
    this.creates.set(key, { documentId, authorId: socket.data.userId, result });
    try { return await result; } finally { this.creates.delete(key); }
  }

  private async createSuggestion(socket: TypeSyncSocket, documentId: string, request: AiCreateRequest): Promise<AiResult> {
    try {
      let error = this.options.rooms.aiAccess(socket, documentId, true);
      if (error) return { success: false, error };
      if (!(this.options.configured ?? isAiConfigured)()) return { success: false, error: "AI co-editor is not configured" };
      const entries = await this.load(documentId);
      error = this.options.rooms.aiAccess(socket, documentId, true);
      if (error) return { success: false, error };
      const duplicate = entries.find(entry => entry.suggestion.requestId === request.requestId);
      if (duplicate) {
        if (duplicate.suggestion.authorId !== socket.data.userId) return { success: false, error: "Request id already used" };
        return { success: true, suggestion: duplicate.suggestion };
      }
      if (this.active.size >= 8 || [...this.active.values()].filter(run => run.documentId === documentId).length >= 2) return { success: false, error: "AI is busy. Try again when a suggestion finishes." };
      if (Date.now() - (this.lastRequests.get(socket.data.userId) ?? 0) < 3000) return { success: false, error: "Wait a few seconds before generating another suggestion" };
      const selected = this.selection(documentId, request);
      let sourceSlice: string;
      let sourceIdentity: string;
      try {
        if (selected.text !== request.sourceText || !selected.text.trim()) return { success: false, error: "Selected text changed. Select it again." };
        sourceSlice = selected.slice;
        sourceIdentity = selected.identity;
      } finally { selected.clone.destroy(); }
      if (entries.length >= 100) {
        const oldest = entries.findIndex(entry => !["streaming", "ready"].includes(entry.suggestion.status));
        if (oldest < 0) return { success: false, error: "Resolve existing suggestions before creating more" };
      }
      const now = new Date().toISOString();
      const entry: Entry = { sourceSlice, sourceIdentity, suggestion: {
        ...request, id: randomUUID(), documentId, authorId: socket.data.userId, authorName: socket.data.userName,
        replacement: "", model: null, createdAt: now, updatedAt: now, status: "streaming",
      } };
      const controller = new AbortController();
      this.active.set(entry.suggestion.id, { documentId, controller, entry });
      this.lastRequests.set(socket.data.userId, Date.now());
      for (const [userId, timestamp] of this.lastRequests) {
        if (Date.now() - timestamp > 60_000) this.lastRequests.delete(userId);
      }
      try { await this.persist(documentId, entry); } catch {
        this.active.delete(entry.suggestion.id);
        return { success: false, error: "Could not save AI suggestion" };
      }
      if (this.deleted.has(documentId)) return { success: false, error: "Document no longer exists" };
      error = this.options.rooms.aiAccess(socket, documentId, true);
      if (error) {
        controller.abort();
        this.active.delete(entry.suggestion.id);
        entry.suggestion = { ...entry.suggestion, status: "failed", error };
        this.changed(entry);
        await this.persist(documentId).catch(() => {});
        return { success: false, error };
      }
      this.changed(entry);
      if (!controller.signal.aborted) void this.generate(entry, controller);
      else {
        this.active.delete(entry.suggestion.id);
        await this.persist(documentId);
        return { success: false, error: this.options.rooms.aiAccess(socket, documentId, true) ?? "Generation interrupted" };
      }
      return { success: true, suggestion: entry.suggestion };
    } catch (error) { return { success: false, error: error instanceof UnsafeAiSelectionError ? error.message : "Could not generate a suggestion for this selection" }; }
  }

  private async generate(entry: Entry, controller: AbortController): Promise<void> {
    const id = entry.suggestion.id;
    const timer = setTimeout(() => controller.abort(), 190_000);
    try {
      await (this.options.provider ?? streamEdit)({
        action: entry.suggestion.action, instruction: entry.suggestion.instruction, sourceText: entry.suggestion.sourceText, signal: controller.signal,
        onModel: model => { if (entry.suggestion.status === "streaming" && !controller.signal.aborted) { entry.suggestion.model = model; this.changed(entry); } },
        onReset: () => {
          if (entry.suggestion.status !== "streaming" || controller.signal.aborted) return;
          entry.suggestion.replacement = "";
          entry.suggestion.model = null;
          this.changed(entry);
        },
        onDelta: delta => {
          if (entry.suggestion.status !== "streaming" || controller.signal.aborted) return;
          if (!PostgresTextSchema.safeParse(delta).success) { controller.abort(); throw new Error("AI response contains null characters"); }
          if (entry.suggestion.replacement.length + delta.length > 24000) { controller.abort(); throw new Error("AI response is too long"); }
          entry.suggestion.replacement += delta;
          this.changed(entry);
        },
      });
      if (entry.suggestion.status === "streaming") {
        if (controller.signal.aborted) throw new Error("Generation timed out or was interrupted");
        if (!entry.suggestion.replacement.trim()) throw new Error("AI returned an empty suggestion");
        entry.suggestion = { ...entry.suggestion, status: "ready" };
      }
    } catch (error) {
      if (entry.suggestion.status === "streaming") entry.suggestion = { ...entry.suggestion, status: "failed", error: error instanceof Error ? error.message : "AI generation failed" };
    } finally {
      clearTimeout(timer);
      this.active.delete(id);
      if (!this.deleted.has(entry.suggestion.documentId)) {
        this.changed(entry);
        try { await this.persist(entry.suggestion.documentId); } catch {
          if (entry.suggestion.status === "streaming" || entry.suggestion.status === "ready") {
            entry.suggestion = { ...entry.suggestion, status: "failed", error: "Could not save the suggestion. Try again." };
            this.changed(entry);
          }
        }
      }
    }
  }

  async resolve(socket: TypeSyncSocket, documentId: string, request: AiResolveRequest): Promise<AiResult> {
    try {
      let error = this.options.rooms.aiAccess(socket, documentId, true);
      if (error) return { success: false, error };
      const entries = await this.load(documentId);
      error = this.options.rooms.aiAccess(socket, documentId, true);
      if (error) return { success: false, error };
      const entry = entries.find(item => item.suggestion.id === request.suggestionId);
      if (!entry) return { success: false, error: "Suggestion no longer exists" };
      if (entry.suggestion.status === "accepted" || entry.suggestion.status === "rejected") {
        if (this.pendingAcceptances.has(entry.suggestion.id)) {
          await this.flushAcceptance(documentId);
          this.pendingAcceptances.delete(entry.suggestion.id);
        }
        await this.persist(documentId);
        return { success: true, suggestion: entry.suggestion };
      }
      if (request.decision === "reject") {
        this.active.get(entry.suggestion.id)?.controller.abort();
        entry.suggestion = { ...entry.suggestion, status: "rejected", resolvedBy: socket.data.userName };
      } else {
        if (entry.suggestion.status !== "ready") return { success: false, error: "Suggestion is not ready to accept" };
        const selected = this.selection(documentId, entry.suggestion);
        try {
          if (selected.text !== entry.suggestion.sourceText || selected.slice !== entry.sourceSlice || selected.identity !== entry.sourceIdentity) return { success: false, error: "Selected text changed since this suggestion. Reject it and generate a new one." };
          const vector = Y.encodeStateVector(selected.clone);
          let marks: readonly Mark[] = [];
          let foundText = false;
          selected.doc.nodesBetween(selected.from, selected.to, node => {
            if (foundText) return false;
            if (node.isText) {
              marks = node.marks;
              foundText = true;
            }
          });
          const nodes = selected.doc.resolve(selected.from).parent.type.spec.code
            ? [editorSchema.text(entry.suggestion.replacement)]
            : entry.suggestion.replacement.split("\n").flatMap((line, index) => [
            ...(index ? [editorSchema.node("hardBreak")] : []),
            ...(line ? [editorSchema.text(line, marks)] : []),
          ]);
          const transform = new Transform(selected.doc).replaceWith(selected.from, selected.to, Fragment.fromArray(nodes));
          transform.doc.check();
          updateYFragment(selected.clone, selected.fragment, transform.doc, { mapping: selected.mapping, isOMark: new Map() });
          const update = Y.encodeStateAsUpdate(selected.clone, vector);
          const applied = this.options.rooms.applyUpdate({ socket, documentId, update });
          if (!applied.success) return { success: false, error: applied.error };
          this.pendingAcceptances.set(entry.suggestion.id, { suggestion: entry.suggestion, epoch: applied.epoch, revision: applied.revision });
          entry.suggestion = { ...entry.suggestion, status: "accepted", resolvedBy: socket.data.userName };
          this.options.emitUpdate(documentId, update, socket.id, { epoch: applied.epoch, revision: applied.revision });
        } finally { selected.clone.destroy(); }
      }
      this.changed(entry);
      if (entry.suggestion.status === "accepted") {
        await this.flushAcceptance(documentId);
        this.pendingAcceptances.delete(entry.suggestion.id);
      }
      await this.persist(documentId);
      return { success: true, suggestion: entry.suggestion };
    } catch (error) { return { success: false, error: error instanceof UnsafeAiSelectionError ? error.message : "Could not resolve AI suggestion" }; }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.creates.values()].map(run => run.result));
    while (this.pendingAcceptances.size || this.dirtyHistories.size) {
      for (const [id, { suggestion }] of this.pendingAcceptances) {
        if (this.deleted.has(suggestion.documentId)) { this.pendingAcceptances.delete(id); continue; }
        await this.flushAcceptance(suggestion.documentId);
        this.pendingAcceptances.delete(id);
      }
      await Promise.all([...this.dirtyHistories.keys()].map(documentId => this.persist(documentId)));
    }
    await Promise.all(this.writes.values());
  }
}
