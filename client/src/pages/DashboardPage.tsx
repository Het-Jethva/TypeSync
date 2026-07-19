import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useBlocker } from "react-router-dom";
import type { BlockerFunction } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "../components/Sidebar";
import { Editor } from "../components/Editor";
import { DocumentHeader } from "../components/DocumentHeader";
import { api } from "../lib/api";
import { connectSocket, disconnectSocket, getSocket } from "../lib/socket";
import type { DocumentWithRole } from "@typesync/shared";

const PENDING_UPDATES_MESSAGE =
  "Some edits have not reached the server yet. Leave anyway? Those edits will be lost.";

export default function DashboardPage() {
  const { id: documentId } = useParams();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentWithRole[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [isLoading, setIsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [nextDocumentsCursor, setNextDocumentsCursor] = useState<string | null>(null);
  const [isLoadingMoreDocuments, setIsLoadingMoreDocuments] = useState(false);
  const [activeCollaborators, setActiveCollaborators] = useState<{ name: string; color: string }[]>([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [notifications, setNotifications] = useState<{ id: string; message: string; type: "error" | "success" }[]>([]);
  const [hasPendingDocumentUpdates, setHasPendingDocumentUpdates] = useState(false);
  const hasLoadedDocumentsRef = useRef(false);
  const documentsRequestGenerationRef = useRef(0);
  const documentsAppendRequestGenerationRef = useRef(0);
  const bypassNextNavigationRef = useRef(false);

  const addNotification = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 5000);
  }, []);

  const confirmLeavingWithPendingUpdates = useCallback(() => {
    if (!hasPendingDocumentUpdates) return true;
    return window.confirm(PENDING_UPDATES_MESSAGE);
  }, [hasPendingDocumentUpdates]);

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

  useEffect(() => {
    if (navigationBlocker.state !== "blocked") return;
    if (window.confirm(PENDING_UPDATES_MESSAGE)) {
      navigationBlocker.proceed();
    } else {
      navigationBlocker.reset();
    }
  }, [navigationBlocker]);

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
    setActiveCollaborators([]);
  }, [documentId]);

  const fetchDocuments = useCallback(async () => {
    const requestGeneration = ++documentsRequestGenerationRef.current;
    documentsAppendRequestGenerationRef.current += 1;
    setNextDocumentsCursor(null);
    setIsLoadingMoreDocuments(false);

    try {
      const res = await api.documents.list();
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
  }, [addNotification]);

  const loadMoreDocuments = useCallback(async () => {
    if (!nextDocumentsCursor || isLoadingMoreDocuments) return;

    const refreshGeneration = documentsRequestGenerationRef.current;
    const appendGeneration = ++documentsAppendRequestGenerationRef.current;
    setIsLoadingMoreDocuments(true);

    try {
      const res = await api.documents.list({ cursor: nextDocumentsCursor });
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
  }, [addNotification, isLoadingMoreDocuments, nextDocumentsCursor]);

  useEffect(() => {
    fetchDocuments();
    connectSocket();
    return () => disconnectSocket();
  }, [fetchDocuments]);

  useEffect(() => {
    const socket = getSocket();

    const handlePermissionUpdated = (payload: { documentId: string; role: "editor" | "viewer" | "owner" }) => {
      setDocuments((current) =>
        current.map((doc) =>
          doc.id === payload.documentId ? { ...doc, role: payload.role } : doc
        )
      );
      fetchDocuments();
    };

    const handlePermissionRevoked = (payload: { documentId: string }) => {
      setDocuments((current) => current.filter((doc) => doc.id !== payload.documentId));
      if (documentId === payload.documentId) {
        bypassNextNavigationRef.current = true;
        navigate("/dashboard");
      }
      fetchDocuments();
    };

    const handleTitleUpdated = (payload: { documentId: string; title: string; updatedAt: string }) => {
      setDocuments((current) =>
        current.map((doc) =>
          doc.id === payload.documentId ? { ...doc, title: payload.title, updatedAt: payload.updatedAt } : doc
        )
      );
      fetchDocuments();
    };

    socket.on("doc:permission-updated", handlePermissionUpdated);
    socket.on("doc:permission-revoked", handlePermissionRevoked);
    socket.on("doc:title-updated", handleTitleUpdated);

    return () => {
      socket.off("doc:permission-updated", handlePermissionUpdated);
      socket.off("doc:permission-revoked", handlePermissionRevoked);
      socket.off("doc:title-updated", handleTitleUpdated);
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

  const handleCreateDocument = async () => {
    const confirmedPendingUpdates = hasPendingDocumentUpdates;
    if (!confirmLeavingWithPendingUpdates()) return;

    try {
      const res = await api.documents.create({ title: "Untitled" });
      if (res.data) {
        await fetchDocuments();
        if (confirmedPendingUpdates) bypassNextNavigationRef.current = true;
        navigate(`/document/${res.data.id}`);
      }
    } catch (err) {
      console.error("Failed to create document:", err);
      const msg = err instanceof Error ? err.message : "Failed to create document";
      addNotification(`Failed to create document: ${msg}`, "error");
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const confirmedPendingUpdates = documentId === docId && hasPendingDocumentUpdates;
    if (documentId === docId && !confirmLeavingWithPendingUpdates()) return;

    try {
      await api.documents.delete(docId);
      await fetchDocuments();
      if (documentId === docId) {
        if (confirmedPendingUpdates) bypassNextNavigationRef.current = true;
        navigate("/dashboard");
      }
      addNotification("Document deleted successfully", "success");
    } catch (err) {
      console.error("Failed to delete document:", err);
      const msg = err instanceof Error ? err.message : "Failed to delete document";
      addNotification(`Failed to delete document: ${msg}`, "error");
    }
  };

  const handleRenameDocument = async (docId: string, title: string) => {
    try {
      await api.documents.update(docId, { title });
      await fetchDocuments();
    } catch (err) {
      console.error("Failed to rename document:", err);
      const msg = err instanceof Error ? err.message : "Failed to rename document";
      addNotification(`Failed to rename document: ${msg}`, "error");
      throw err;
    }
  };

  const currentDoc = documents.find((d) => d.id === documentId);

  const renderDocumentsError = () => (
    <div className="h-full flex items-center justify-center bg-bg-secondary/20">
      <div className="text-center max-w-sm px-6">
        <h3 className="text-base font-semibold text-text-primary tracking-tight font-sans mb-1.5">
          Couldn't load documents
        </h3>
        <p className="text-xs text-text-secondary mb-5 leading-relaxed">{documentsError}</p>
        <button
          onClick={() => {
            setDocumentsError(null);
            setIsLoading(true);
            void fetchDocuments();
          }}
          className="btn-linear-primary text-xs px-4 py-2"
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
              hasMore={nextDocumentsCursor !== null}
              isLoadingMore={isLoadingMoreDocuments}
              onLoadMore={loadMoreDocuments}
              onCreateDocument={handleCreateDocument}
              onDeleteDocument={handleDeleteDocument}
              onSelectDocument={(id) => {
                if (id !== documentId) {
                  navigate(`/document/${id}`);
                }
                if (isMobile) {
                  setSidebarOpen(false);
                }
              }}
              onBeforeSignOut={() => {
                const canLeave = confirmLeavingWithPendingUpdates();
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
            className="w-8 h-8 rounded-lg hover:bg-bg-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            title="Toggle sidebar (Ctrl+\\)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
              <path d="M4 6h16M4 12h16M4 18h16" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </motion.button>

          {currentDoc && (
            <DocumentHeader
              document={currentDoc}
              onRename={(title) => handleRenameDocument(currentDoc.id, title)}
              onDocumentUpdate={fetchDocuments}
              activeCollaborators={activeCollaborators}
            />
          )}
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-auto">
          {documentId ? (
            isLoading ? (
              <div className="h-full flex items-center justify-center bg-bg-secondary/20">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 rounded-full border-2 border-border-strong border-t-primary animate-spin" />
                  <span className="text-xs text-text-secondary font-medium">Loading document...</span>
                </div>
              </div>
            ) : documentsError ? (
              renderDocumentsError()
            ) : currentDoc ? (
              <Editor
                documentId={documentId}
                role={currentDoc.role}
                onCollaboratorsChange={setActiveCollaborators}
                onPendingUpdatesChange={setHasPendingDocumentUpdates}
                onAccessLost={() => {
                  fetchDocuments();
                  bypassNextNavigationRef.current = true;
                  navigate("/dashboard");
                }}
              />
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
                  <h3 className="text-base font-semibold text-text-primary tracking-tight font-sans mb-1.5">Document not found</h3>
                  <p className="text-xs text-text-secondary mb-5 leading-relaxed">This manuscript does not exist, or you do not have permission to access it.</p>
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="btn-linear-primary text-xs px-4 py-2"
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
                <h3 className="text-base font-semibold text-text-primary tracking-tight font-sans mb-1.5">No document active</h3>
                <p className="text-xs text-text-secondary mb-5 leading-relaxed">Select a manuscript from your library or initialize a new draft to begin writing.</p>
                <button
                  onClick={handleCreateDocument}
                  className="btn-linear-primary text-xs px-4 py-2"
                >
                  Create document
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
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className={`pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded border shadow-lg text-[11px] font-medium max-w-sm bg-bg-elevated ${
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
              <span className="flex-1 leading-normal">{notif.message}</span>
              <button
                onClick={() => setNotifications((prev) => prev.filter((n) => n.id !== notif.id))}
                className="text-text-muted hover:text-text-primary transition-colors shrink-0 cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3 h-3" strokeWidth="2">
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
