import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useBlocker } from "react-router";
import type { BlockerFunction } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "../components/Sidebar";
import { Editor } from "../components/Editor";
import { DocumentHeader } from "../components/DocumentHeader";
import { ApiError, api } from "../lib/api";
import { connectSocket, disconnectSocket, getSocket } from "../lib/socket";
import { useConfirm } from "../lib/confirm-context";
import { useSession } from "../lib/auth-client";
import type { DocumentWithRole } from "@typesync/shared";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type { DocumentStatus } from "../lib/document-status";
import type { ActiveCollaborator } from "../lib/presence";

function isNewerOrEqual(newIso: string, currentIso: string): boolean {
  const newTime = new Date(newIso).getTime();
  const currentTime = new Date(currentIso).getTime();
  if (isNaN(newTime)) return false;
  if (isNaN(currentTime)) return true;
  return newTime >= currentTime;
}

const PENDING_UPDATES_CONFIRM = {
  title: "Leave with unsynced edits?",
  message:
    "Some edits have not reached the server yet. If you leave now, those edits will be lost.",
  confirmLabel: "Leave anyway",
  tone: "danger",
} as const;

export default function DashboardPage() {
  const { id: documentId } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: session } = useSession();
  const [documents, setDocuments] = useState<DocumentWithRole[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [isLoading, setIsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [nextDocumentsCursor, setNextDocumentsCursor] = useState<string | null>(null);
  const [isLoadingMoreDocuments, setIsLoadingMoreDocuments] = useState(false);
  const [activeCollaborators, setActiveCollaborators] = useState<ActiveCollaborator[]>([]);
  const [activeEditor, setActiveEditor] = useState<TiptapEditor | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [notifications, setNotifications] = useState<{ id: string; message: string; type: "error" | "success" }[]>([]);
  const [documentStatus, setDocumentStatus] = useState<DocumentStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const hasPendingDocumentUpdates = documentStatus?.hasPendingUpdates ?? false;
  const [routeDocument, setRouteDocument] = useState<DocumentWithRole | null>(null);
  const [isRouteDocumentLoading, setIsRouteDocumentLoading] = useState(false);
  const [routeDocumentError, setRouteDocumentError] = useState<Error | null>(null);
  const [routeDocumentRequestNonce, setRouteDocumentRequestNonce] = useState(0);
  const [isCreatingDocument, setIsCreatingDocument] = useState(false);
  const [deletingDocumentIds, setDeletingDocumentIds] = useState<Set<string>>(
    () => new Set()
  );
  const hasLoadedDocumentsRef = useRef(false);
  const documentsRequestGenerationRef = useRef(0);
  const documentsAppendRequestGenerationRef = useRef(0);
  const routeDocumentRequestGenerationRef = useRef(0);
  const documentIdRef = useRef(documentId);
  const documentsRef = useRef(documents);
  const bypassNextNavigationRef = useRef(false);

  // Confirmations can expire on their own; failures cannot. An error that
  // disappears after five seconds is an error the reader may never have seen.
  const addNotification = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications((prev) => [...prev, { id, message, type }]);
    if (type === "error") return;
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  }, []);

  const confirmLeavingWithPendingUpdates = useCallback(async () => {
    if (!hasPendingDocumentUpdates) return true;
    return confirm(PENDING_UPDATES_CONFIRM);
  }, [confirm, hasPendingDocumentUpdates]);

  const shouldBlockNavigation: BlockerFunction = useCallback(
    ({ currentLocation, nextLocation }) => {
      if (bypassNextNavigationRef.current) {
        bypassNextNavigationRef.current = false;
        return false;
      }
      return (
        hasPendingDocumentUpdates &&
        currentLocation.pathname !== nextLocation.pathname
      );
    },
    [hasPendingDocumentUpdates]
  );
  const navigationBlocker = useBlocker(shouldBlockNavigation);

  // The prompt is asynchronous now, so the effect can re-run while it is still
  // open. The ref keeps one blocked navigation to one question.
  const blockerPromptOpenRef = useRef(false);
  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;
    if (blockerPromptOpenRef.current) return;

    blockerPromptOpenRef.current = true;
    void confirm(PENDING_UPDATES_CONFIRM).then((accepted) => {
      blockerPromptOpenRef.current = false;
      if (accepted) {
        navigationBlocker.proceed();
      } else {
        navigationBlocker.reset();
      }
    });
  }, [confirm, navigationBlocker]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile((prev) => {
        if (prev !== mobile) {
          setSidebarOpen(!mobile);
        }
        return mobile;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    documentIdRef.current = documentId;
    setActiveCollaborators([]);
  }, [documentId]);

  // Search runs on the server, so it is debounced rather than issuing a
  // request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(searchQuery.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Mirrors the list for socket handlers, which must distinguish a role change
  // on a document already listed from a first-time grant that is not.
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const routeDocumentIsInList = documents.some(
    (document) => document.id === documentId
  );

  useEffect(() => {
    const requestGeneration = ++routeDocumentRequestGenerationRef.current;
    setRouteDocument(null);
    setRouteDocumentError(null);

    if (!documentId || routeDocumentIsInList) {
      setIsRouteDocumentLoading(false);
      return;
    }

    setIsRouteDocumentLoading(true);
    void api.documents.get(documentId).then(
      (response) => {
        if (
          requestGeneration !== routeDocumentRequestGenerationRef.current ||
          documentIdRef.current !== documentId
        ) return;
        setRouteDocument(response.data ?? null);
        setIsRouteDocumentLoading(false);
      },
      (error: unknown) => {
        if (
          requestGeneration !== routeDocumentRequestGenerationRef.current ||
          documentIdRef.current !== documentId
        ) return;
        setRouteDocumentError(
          error instanceof Error ? error : new Error("Failed to load document")
        );
        setIsRouteDocumentLoading(false);
      }
    );
  }, [documentId, routeDocumentIsInList, routeDocumentRequestNonce]);

  const fetchDocuments = useCallback(async () => {
    const requestGeneration = ++documentsRequestGenerationRef.current;
    documentsAppendRequestGenerationRef.current += 1;
    setNextDocumentsCursor(null);
    setIsLoadingMoreDocuments(false);

    try {
      const res = await api.documents.list(
        debouncedSearch ? { q: debouncedSearch } : {}
      );
      if (requestGeneration !== documentsRequestGenerationRef.current) return;
      if (res.data) {
        setDocuments(res.data.items);
        setNextDocumentsCursor(res.data.nextCursor);
        hasLoadedDocumentsRef.current = true;
        setDocumentsError(null);
      }
    } catch (err) {
      if (requestGeneration !== documentsRequestGenerationRef.current) return;
      console.error("Failed to fetch documents:", err);
      const message = err instanceof Error ? err.message : "Failed to load documents";
      if (hasLoadedDocumentsRef.current) {
        addNotification(`Failed to refresh documents: ${message}`, "error");
      } else {
        setDocumentsError(message);
      }
    } finally {
      if (requestGeneration === documentsRequestGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, [addNotification, debouncedSearch]);

  const loadMoreDocuments = useCallback(async () => {
    if (!nextDocumentsCursor || isLoadingMoreDocuments) return;

    const refreshGeneration = documentsRequestGenerationRef.current;
    const appendGeneration = ++documentsAppendRequestGenerationRef.current;
    setIsLoadingMoreDocuments(true);

    try {
      const res = await api.documents.list({
        cursor: nextDocumentsCursor,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
      });
      if (
        refreshGeneration !== documentsRequestGenerationRef.current ||
        appendGeneration !== documentsAppendRequestGenerationRef.current
      ) return;
      if (res.data) {
        const page = res.data;
        setDocuments((current) => {
          const loadedIds = new Set(current.map((document) => document.id));
          const newItems = page.items.filter((document) => !loadedIds.has(document.id));
          return [...current, ...newItems];
        });
        setNextDocumentsCursor(page.nextCursor);
      }
    } catch (err) {
      if (
        refreshGeneration !== documentsRequestGenerationRef.current ||
        appendGeneration !== documentsAppendRequestGenerationRef.current
      ) return;
      console.error("Failed to load more documents:", err);
      const message = err instanceof Error ? err.message : "Failed to load more documents";
      addNotification(`Failed to load more documents: ${message}`, "error");
    } finally {
      if (
        refreshGeneration === documentsRequestGenerationRef.current &&
        appendGeneration === documentsAppendRequestGenerationRef.current
      ) {
        setIsLoadingMoreDocuments(false);
      }
    }
  }, [addNotification, debouncedSearch, isLoadingMoreDocuments, nextDocumentsCursor]);

  // The socket outlives any individual query, so its lifecycle is kept apart
  // from fetching. Tying the two together reconnected it on every keystroke.
  useEffect(() => {
    connectSocket();
    return () => disconnectSocket();
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    const socket = getSocket();

    const handlePermissionUpdated = (payload: { documentId: string; role: "editor" | "viewer" | "owner" }) => {
      // The server sends this to every socket of the granted user, including
      // ones that have never opened the document. A role change on a document
      // we already list is a local patch; a first-time grant is not in the list
      // at all, so that case — and only that case — needs the list refetched.
      const isKnownDocument = documentsRef.current.some(
        (doc) => doc.id === payload.documentId
      );
      setDocuments((current) =>
        current.map((doc) =>
          doc.id === payload.documentId ? { ...doc, role: payload.role } : doc
        )
      );
      setRouteDocument((current) =>
        current?.id === payload.documentId ? { ...current, role: payload.role } : current
      );
      if (!isKnownDocument) fetchDocuments();
    };

    const handlePermissionRevoked = (payload: { documentId: string }) => {
      setDocuments((current) => current.filter((doc) => doc.id !== payload.documentId));
      if (documentId === payload.documentId) {
        routeDocumentRequestGenerationRef.current += 1;
        setRouteDocument(null);
        setIsRouteDocumentLoading(false);
        bypassNextNavigationRef.current = true;
        navigate("/dashboard");
      }
    };

    const handleTitleUpdated = (payload: { documentId: string; title: string; updatedAt: string }) => {
      setDocuments((current) =>
        current.map((doc) => {
          if (doc.id !== payload.documentId) return doc;
          const newUpdatedAt = isNewerOrEqual(payload.updatedAt, doc.updatedAt)
            ? payload.updatedAt
            : doc.updatedAt;
          return { ...doc, title: payload.title, updatedAt: newUpdatedAt };
        })
      );
      setRouteDocument((current) => {
        if (current?.id !== payload.documentId) return current;
        const newUpdatedAt = isNewerOrEqual(payload.updatedAt, current.updatedAt)
          ? payload.updatedAt
          : current.updatedAt;
        return { ...current, title: payload.title, updatedAt: newUpdatedAt };
      });
    };

    const handleDocSaved = (payload: { documentId: string; updatedAt: string }) => {
      setDocuments((current) =>
        current.map((doc) => {
          if (doc.id !== payload.documentId) return doc;
          if (!isNewerOrEqual(payload.updatedAt, doc.updatedAt)) return doc;
          return { ...doc, updatedAt: payload.updatedAt };
        })
      );
      setRouteDocument((current) => {
        if (current?.id !== payload.documentId) return current;
        if (!isNewerOrEqual(payload.updatedAt, current.updatedAt)) return current;
        return { ...current, updatedAt: payload.updatedAt };
      });
    };

    socket.on("doc:permission-updated", handlePermissionUpdated);
    socket.on("doc:permission-revoked", handlePermissionRevoked);
    socket.on("doc:title-updated", handleTitleUpdated);
    socket.on("doc:saved", handleDocSaved);

    return () => {
      socket.off("doc:permission-updated", handlePermissionUpdated);
      socket.off("doc:permission-revoked", handlePermissionRevoked);
      socket.off("doc:title-updated", handleTitleUpdated);
      socket.off("doc:saved", handleDocSaved);
    };
  }, [documentId, fetchDocuments, navigate]);

  // Keyboard shortcut for sidebar toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((p) => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Mutations resolve the UI from the response they already have instead of
  // refetching the whole list. A list refetch is a second cross-origin round
  // trip that the user waits through before anything on screen moves.
  const handleCreateDocument = async () => {
    if (isCreatingDocument) return;
    const confirmedPendingUpdates = hasPendingDocumentUpdates;
    if (!(await confirmLeavingWithPendingUpdates())) return;

    setIsCreatingDocument(true);
    try {
      const res = await api.documents.create({ title: "Untitled" });
      if (res.data) {
        const created: DocumentWithRole = { ...res.data, role: "owner" };
        setDocuments((current) =>
          current.some((document) => document.id === created.id)
            ? current
            : [created, ...current]
        );
        if (confirmedPendingUpdates) bypassNextNavigationRef.current = true;
        navigate(`/document/${created.id}`);
      }
    } catch (err) {
      console.error("Failed to create document:", err);
      const msg = err instanceof Error ? err.message : "Failed to create document";
      addNotification(`Failed to create document: ${msg}`, "error");
    } finally {
      setIsCreatingDocument(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const confirmedPendingUpdates = documentId === docId && hasPendingDocumentUpdates;
    if (documentId === docId && !(await confirmLeavingWithPendingUpdates())) return;
    if (deletingDocumentIds.has(docId)) return;

    const removedDocument = documents.find((document) => document.id === docId);
    const removedIndex = documents.findIndex((document) => document.id === docId);

    setDeletingDocumentIds((current) => new Set(current).add(docId));
    setDocuments((current) => current.filter((document) => document.id !== docId));
    if (documentId === docId) {
      if (confirmedPendingUpdates) bypassNextNavigationRef.current = true;
      navigate("/dashboard");
    }

    try {
      await api.documents.delete(docId);
      addNotification("Document deleted successfully", "success");
    } catch (err) {
      console.error("Failed to delete document:", err);
      const msg = err instanceof Error ? err.message : "Failed to delete document";
      addNotification(`Failed to delete document: ${msg}`, "error");
      if (removedDocument) {
        setDocuments((current) => {
          if (current.some((document) => document.id === docId)) return current;
          const restored = [...current];
          restored.splice(Math.max(removedIndex, 0), 0, removedDocument);
          return restored;
        });
      }
    } finally {
      setDeletingDocumentIds((current) => {
        const next = new Set(current);
        next.delete(docId);
        return next;
      });
    }
  };

  const applyDocumentTitle = useCallback((docId: string, title: string) => {
    setDocuments((current) =>
      current.map((document) =>
        document.id === docId ? { ...document, title } : document
      )
    );
    setRouteDocument((current) =>
      current?.id === docId ? { ...current, title } : current
    );
  }, []);

  const handleRenameDocument = async (docId: string, title: string) => {
    const previousTitle =
      documents.find((document) => document.id === docId)?.title ??
      (routeDocument?.id === docId ? routeDocument.title : undefined);

    applyDocumentTitle(docId, title);
    try {
      await api.documents.update(docId, { title });
    } catch (err) {
      console.error("Failed to rename document:", err);
      if (previousTitle !== undefined) applyDocumentTitle(docId, previousTitle);
      const msg = err instanceof Error ? err.message : "Failed to rename document";
      addNotification(`Failed to rename document: ${msg}`, "error");
      throw err;
    }
  };

  const handleLeaveDocument = async (docId: string) => {
    const userId = session?.user?.id;
    if (!userId) return;

    const removedDocument = documents.find((document) => document.id === docId);
    const removedIndex = documents.findIndex((document) => document.id === docId);

    setDocuments((current) => current.filter((document) => document.id !== docId));
    if (documentId === docId) {
      bypassNextNavigationRef.current = true;
      navigate("/dashboard");
    }

    try {
      await api.documents.removeCollaborator(docId, userId);
      addNotification("You left the document", "success");
    } catch (err) {
      console.error("Failed to leave document:", err);
      const msg = err instanceof Error ? err.message : "Failed to leave document";
      addNotification(`Failed to leave document: ${msg}`, "error");
      if (removedDocument) {
        setDocuments((current) => {
          if (current.some((document) => document.id === docId)) return current;
          const restored = [...current];
          restored.splice(Math.max(removedIndex, 0), 0, removedDocument);
          return restored;
        });
      }
    }
  };

  const handleCopyLink = async (docId: string) => {
    const link = `${window.location.origin}/document/${docId}`;
    try {
      await navigator.clipboard.writeText(link);
      addNotification("Link copied to clipboard", "success");
    } catch {
      addNotification("Could not copy the link", "error");
    }
  };

  const handleRetryDocuments = useCallback(() => {
    setDocumentsError(null);
    setIsLoading(true);
    void fetchDocuments();
  }, [fetchDocuments]);

  const currentDoc =
    documents.find((document) => document.id === documentId) ??
    (routeDocument?.id === documentId ? routeDocument : undefined);
  const routeDocumentNotFound =
    routeDocumentError instanceof ApiError &&
    (routeDocumentError.status === 403 || routeDocumentError.status === 404);
  const isFetchingRouteDoc =
    isRouteDocumentLoading ||
    (Boolean(documentId) &&
      !routeDocumentIsInList &&
      routeDocument?.id !== documentId &&
      !routeDocumentError);

  const renderDocumentsError = () => (
    <div className="h-full flex items-center justify-center bg-bg-secondary/20">
      <div className="text-center max-w-sm px-6">
        <h3 className="text-display font-semibold text-text-primary tracking-tight font-sans mb-1.5">
          Couldn't load documents
        </h3>
        <p className="text-ui text-text-secondary mb-5 leading-relaxed">{documentsError}</p>
        <button
          onClick={handleRetryDocuments}
          className="btn-linear-primary text-ui px-4 py-2"
        >
          Try again
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex bg-bg-primary overflow-hidden">
      {/* Sidebar Backdrop Overlay for Mobile */}
      <AnimatePresence>
        {isMobile && sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-black/30 backdrop-blur-xs z-30"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.div
            {...(isMobile
              ? {
                  initial: { x: "-100%" },
                  animate: { x: 0 },
                  exit: { x: "-100%" },
                  transition: { type: "tween", ease: "easeOut", duration: 0.22 },
                  className: "fixed top-0 left-0 bottom-0 h-full overflow-hidden z-40 shadow-xl border-r border-border bg-bg-secondary",
                }
              : {
                  initial: { width: 0, opacity: 0 },
                  animate: { width: 280, opacity: 1 },
                  exit: { width: 0, opacity: 0 },
                  transition: { type: "tween", ease: "easeInOut", duration: 0.22 },
                  className: "h-full overflow-hidden shrink-0 border-r border-border",
                })}
          >
            <Sidebar
              documents={documents}
              activeDocId={documentId}
              isLoading={isLoading}
              isCreating={isCreatingDocument}
              error={documentsError}
              onRetry={handleRetryDocuments}
              hasMore={nextDocumentsCursor !== null}
              isLoadingMore={isLoadingMoreDocuments}
              onLoadMore={loadMoreDocuments}
              search={searchQuery}
              onSearchChange={setSearchQuery}
              onCreateDocument={handleCreateDocument}
              onDeleteDocument={handleDeleteDocument}
              onLeaveDocument={(id) => void handleLeaveDocument(id)}
              // Rejects so the header can revert its own input; the sidebar has
              // no local copy to restore and the failure is already reported.
              onRenameDocument={(id, title) => {
                void handleRenameDocument(id, title).catch(() => {});
              }}
              onCopyLink={(id) => void handleCopyLink(id)}
              onSelectDocument={(id) => {
                if (id !== documentId) {
                  navigate(`/document/${id}`);
                }
                if (isMobile) {
                  setSidebarOpen(false);
                }
              }}
              onBeforeSignOut={async () => {
                const canLeave = await confirmLeavingWithPendingUpdates();
                if (canLeave && hasPendingDocumentUpdates) {
                  bypassNextNavigationRef.current = true;
                }
                return canLeave;
              }}
              onClose={() => setSidebarOpen(false)}
              showCloseButton={isMobile}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="shrink-0 h-14 border-b border-border flex items-center px-4 gap-3 bg-bg-primary">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSidebarOpen((p) => !p)}
            aria-label="Toggle sidebar"
            className="touch-target w-8 h-8 rounded-lg hover:bg-bg-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            title="Toggle sidebar (Ctrl+\\)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
              <path d="M4 6h16M4 12h16M4 18h16" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </motion.button>

          {currentDoc && (
            <DocumentHeader
              document={currentDoc}
              editor={activeEditor}
              status={documentStatus}
              isCompact={isMobile}
              onRename={(title) => handleRenameDocument(currentDoc.id, title)}
              onDocumentUpdate={fetchDocuments}
              activeCollaborators={activeCollaborators}
            />
          )}
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-auto">
          {documentId ? (
            currentDoc ? (
              <Editor
                documentId={documentId}
                role={currentDoc.role}
                onCollaboratorsChange={setActiveCollaborators}
                onEditorChange={setActiveEditor}
                onStatusChange={setDocumentStatus}
                onAccessLost={() => {
                  fetchDocuments();
                  bypassNextNavigationRef.current = true;
                  navigate("/dashboard");
                }}
              />
            ) : isFetchingRouteDoc ? (
              // Skeletons rather than a spinner, matching the sidebar: they take
              // the shape the page is about to have, so the wait reads as
              // content arriving.
              <div
                className="h-full overflow-hidden bg-bg-secondary/40 sm:py-8 sm:px-4 py-2 px-0 flex justify-center"
                role="status"
                aria-live="polite"
                aria-label="Loading document"
              >
                <div className="w-full max-w-2xl bg-bg-elevated px-8 py-10" aria-hidden="true">
                  <div className="h-6 w-1/2 rounded bg-bg-tertiary animate-pulse" />
                  <div className="mt-8 space-y-3">
                    {[92, 100, 84, 96, 70].map((width, row) => (
                      <div
                        key={row}
                        className="h-3 rounded bg-bg-tertiary animate-pulse"
                        style={{ width: `${width}%` }}
                      />
                    ))}
                  </div>
                </div>
                <span className="sr-only">Loading document…</span>
              </div>
            ) : routeDocumentError && !routeDocumentNotFound ? (
              <div className="h-full flex items-center justify-center bg-bg-secondary/20">
                <div className="text-center max-w-sm px-6">
                  <h3 className="text-display font-semibold text-text-primary tracking-tight font-sans mb-1.5">
                    Couldn't load document
                  </h3>
                  <p className="text-ui text-text-secondary mb-5 leading-relaxed">
                    {routeDocumentError.message}
                  </p>
                  <button
                    onClick={() => setRouteDocumentRequestNonce((nonce) => nonce + 1)}
                    className="btn-linear-primary text-ui px-4 py-2"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center bg-bg-secondary/20">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center max-w-sm px-6"
                >
                  <div className="w-12 h-12 rounded bg-bg-secondary border border-border-strong flex items-center justify-center mx-auto mb-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 text-text-muted">
                      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h3 className="text-display font-semibold text-text-primary tracking-tight font-sans mb-1.5">Document not found</h3>
                  <p className="text-ui text-text-secondary mb-5 leading-relaxed">This document does not exist, or you do not have access to it.</p>
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="btn-linear-primary text-ui px-4 py-2"
                  >
                    Back to dashboard
                  </button>
                </motion.div>
              </div>
            )
          ) : documentsError ? (
            renderDocumentsError()
          ) : (
            <div className="h-full flex items-center justify-center bg-bg-secondary/20">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center max-w-sm px-6"
              >
                <div className="w-12 h-12 rounded bg-bg-secondary border border-border-strong flex items-center justify-center mx-auto mb-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 text-text-muted">
                    <path d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 6v6h6" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="text-display font-semibold text-text-primary tracking-tight font-sans mb-1.5">No document open</h3>
                <p className="text-ui text-text-secondary mb-5 leading-relaxed">Pick a document from the sidebar, or create a new one to start writing.</p>
                <button
                  onClick={handleCreateDocument}
                  disabled={isCreatingDocument}
                  className="btn-linear-primary text-ui px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreatingDocument ? "Creating…" : "Create document"}
                </button>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      {/* Toast Notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map((notif) => (
            <motion.div
              key={notif.id}
              role={notif.type === "error" ? "alert" : "status"}
              aria-live={notif.type === "error" ? "assertive" : "polite"}
              aria-atomic="true"
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className={`pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded border shadow-lg text-meta font-medium max-w-sm bg-bg-elevated ${
                notif.type === "error"
                  ? "border-error/30 text-error"
                  : "border-success/30 text-success"
              }`}
            >
              {notif.type === "error" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5 shrink-0" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5 shrink-0" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              )}
              {/* Errors now stay until dismissed, so a long server message
                  must wrap rather than push the dismiss button out of reach. */}
              <span className="flex-1 min-w-0 break-words leading-normal">{notif.message}</span>
              <button
                onClick={() => setNotifications((prev) => prev.filter((n) => n.id !== notif.id))}
                aria-label="Dismiss notification"
                className="touch-target text-text-muted hover:text-text-primary transition-colors shrink-0 cursor-pointer"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3 h-3" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
