import { useCallback, useEffect, useRef, useState } from "react";
import type { AiCreateRequest, AiListResult, AiResolveRequest, AiResult, AiSuggestion } from "@typesync/shared";
import { getSocket } from "../socket";

function mergeSuggestion(current: AiSuggestion[], next: AiSuggestion): AiSuggestion[] {
  const previous = current.find(item => item.id === next.id);
  if (previous && previous.updatedAt > next.updatedAt) return current;
  if (previous && previous.updatedAt === next.updatedAt) {
    const previousTerminal = previous.status !== "streaming" && previous.status !== "ready";
    const nextTerminal = next.status !== "streaming" && next.status !== "ready";
    if ((previousTerminal && !nextTerminal) || (previous.status === "ready" && next.status === "streaming") ||
      (previous.status === next.status && previous.replacement.length >= next.replacement.length)) return current;
  }
  return [next, ...current.filter(item => item.id !== next.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function useAiSuggestions(documentId: string, syncReady: boolean) {
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(() => getSocket().connected);
  const alive = useRef(true);
  const operation = useRef(0);
  const pendingList = useRef<{ receivedIds: Set<string> } | null>(null);

  useEffect(() => {
    alive.current = true;
    const socket = getSocket();
    const receive = (payload: { documentId: string; suggestion: AiSuggestion }) => {
      if (payload.documentId === documentId) {
        pendingList.current?.receivedIds.add(payload.suggestion.id);
        setSuggestions(current => mergeSuggestion(current, payload.suggestion));
      }
    };
    const connect = () => setConnected(true);
    const disconnect = () => setConnected(false);
    socket.on("ai:suggestion", receive);
    socket.on("connect", connect);
    socket.on("disconnect", disconnect);
    return () => {
      alive.current = false;
      socket.off("ai:suggestion", receive);
      socket.off("connect", connect);
      socket.off("disconnect", disconnect);
    };
  }, [documentId]);

  const refresh = useCallback(() => {
    const socket = getSocket();
    if (!syncReady || !socket.connected) return;
    const generation = ++operation.current;
    pendingList.current = { receivedIds: new Set() };
    socket.timeout(10000).emit("ai:list", documentId, (timeout: Error | null, result: AiListResult) => {
      if (!alive.current || generation !== operation.current) return;
      const receivedIds = pendingList.current?.receivedIds ?? new Set<string>();
      pendingList.current = null;
      if (timeout) {
        setError("Could not load AI suggestions. Try refreshing.");
      } else if (!result.success) {
        setError(result.error);
      } else {
        setConfigured(result.configured);
        const authoritativeIds = new Set(result.suggestions.map(suggestion => suggestion.id));
        setSuggestions(current => result.suggestions.reduce(mergeSuggestion,
          current.filter(suggestion => authoritativeIds.has(suggestion.id) || receivedIds.has(suggestion.id))));
        setError(null);
      }
    });
  }, [documentId, syncReady]);

  useEffect(() => {
    refresh();
  }, [refresh, connected]);

  const create = useCallback((request: AiCreateRequest): Promise<AiResult> => {
    const socket = getSocket();
    if (!socket.connected || !syncReady) return Promise.resolve({ success: false, error: "Wait for the document to sync before asking AI." });
    return new Promise(resolve => {
      socket.timeout(15000).emit("ai:create", documentId, request, (timeout: Error | null, result: AiResult) => {
        if (timeout) return resolve({ success: false, error: "The request was not confirmed. Retry to check the same request without creating another suggestion." });
        if (result.success && alive.current) setSuggestions(current => mergeSuggestion(current, result.suggestion));
        resolve(result);
      });
    });
  }, [documentId, syncReady]);

  const resolveSuggestion = useCallback((request: AiResolveRequest): Promise<AiResult> => {
    const socket = getSocket();
    if (!socket.connected || !syncReady) return Promise.resolve({ success: false, error: "Wait for the document to sync before reviewing suggestions." });
    return new Promise(resolve => {
      socket.timeout(15000).emit("ai:resolve", documentId, request, (timeout: Error | null, result: AiResult) => {
        if (timeout) return resolve({ success: false, error: "The decision was not confirmed. Refresh suggestions before trying again." });
        if (result.success && alive.current) setSuggestions(current => mergeSuggestion(current, result.suggestion));
        resolve(result);
      });
    });
  }, [documentId, syncReady]);

  return { suggestions, configured, error, connected, refresh, create, resolveSuggestion };
}
