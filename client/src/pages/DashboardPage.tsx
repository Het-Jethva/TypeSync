import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Sidebar } from "../components/Sidebar";
import { Editor } from "../components/Editor";
import { DocumentHeader } from "../components/DocumentHeader";
import { api } from "../lib/api";
import { connectSocket, disconnectSocket } from "../lib/socket";
import type { Document } from "@typesync/shared";

export default function DashboardPage() {
  const { id: documentId } = useParams();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<(Document & { role: string })[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

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
      {/* Sidebar */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="h-full overflow-hidden shrink-0 border-r border-border"
          >
            <Sidebar
              documents={documents}
              activeDocId={documentId}
              isLoading={isLoading}
              onCreateDocument={handleCreateDocument}
              onDeleteDocument={handleDeleteDocument}
              onSelectDocument={(id) => navigate(`/document/${id}`)}
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
            />
          )}
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-auto">
          {documentId ? (
            <Editor documentId={documentId} />
          ) : (
            <div className="h-full flex items-center justify-center">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center"
              >
                <div className="w-16 h-16 rounded-2xl bg-bg-tertiary border border-border flex items-center justify-center mx-auto mb-4">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-7 h-7 text-text-muted">
                    <path d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 6v6h6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-text-primary mb-1">No document selected</h3>
                <p className="text-sm text-text-muted mb-4">Select a document from the sidebar or create a new one</p>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleCreateDocument}
                  className="text-sm font-medium bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg transition-colors"
                >
                  New document
                </motion.button>
              </motion.div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
