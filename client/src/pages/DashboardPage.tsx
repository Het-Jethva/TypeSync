import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "../components/Sidebar";
import { Editor } from "../components/Editor";
import { DocumentHeader } from "../components/DocumentHeader";
import { api } from "../lib/api";
import { connectSocket, disconnectSocket, getSocket } from "../lib/socket";
import type { Document } from "@typesync/shared";

export default function DashboardPage() {
  const { id: documentId } = useParams();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<(Document & { role: string })[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCollaborators, setActiveCollaborators] = useState<{ name: string; color: string }[]>([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

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
    try {
      const res = await api.documents.list();
      if (res.data) {
        setDocuments(res.data);
      }
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
        navigate("/dashboard");
      }
      fetchDocuments();
    };

    socket.on("doc:permission-updated", handlePermissionUpdated);
    socket.on("doc:permission-revoked", handlePermissionRevoked);

    return () => {
      socket.off("doc:permission-updated", handlePermissionUpdated);
      socket.off("doc:permission-revoked", handlePermissionRevoked);
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
    try {
      const res = await api.documents.create({ title: "Untitled" });
      if (res.data) {
        await fetchDocuments();
        navigate(`/document/${res.data.id}`);
      }
    } catch (err) {
      console.error("Failed to create document:", err);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await api.documents.delete(docId);
      await fetchDocuments();
      if (documentId === docId) {
        navigate("/dashboard");
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  };

  const handleRenameDocument = async (docId: string, title: string) => {
    try {
      await api.documents.update(docId, { title });
      await fetchDocuments();
    } catch (err) {
      console.error("Failed to rename document:", err);
    }
  };

  const currentDoc = documents.find((d) => d.id === documentId);

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
              onCreateDocument={handleCreateDocument}
              onDeleteDocument={handleDeleteDocument}
              onSelectDocument={(id) => {
                navigate(`/document/${id}`);
                if (isMobile) {
                  setSidebarOpen(false);
                }
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
            <Editor
              documentId={documentId}
              role={currentDoc?.role ?? "viewer"}
              onCollaboratorsChange={setActiveCollaborators}
              onAccessLost={() => {
                fetchDocuments();
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
    </div>
  );
}
