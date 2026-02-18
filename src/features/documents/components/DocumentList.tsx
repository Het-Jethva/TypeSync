import React, { FormEvent, useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { auth } from "../../../lib/firebase"
import { documentService } from "../documentService"
import type { DocumentListItem } from "../types"

interface DocumentListProps {
  documents: DocumentListItem[]
  selectedDocId: string | null
  onSelectDocument: (documentId: string) => void
}

const DocumentList: React.FC<DocumentListProps> = ({
  documents,
  selectedDocId,
  onSelectDocument,
}) => {
  const [loading, setLoading] = useState(false)
  const [showNewDocForm, setShowNewDocForm] = useState<boolean>(false)
  const [newDocName, setNewDocName] = useState<string>("")

  const handleCreateDocument = async (e: FormEvent) => {
    e.preventDefault()
    if (!newDocName.trim()) return
    setLoading(true)
    try {
      const newDocId = uuidv4()
      await documentService.createDocument(newDocId, newDocName.trim())
      const currentUser = auth.currentUser
      if (currentUser?.email) {
        await documentService.addUser(newDocId, currentUser.email)
      }
      onSelectDocument(newDocId)
      setNewDocName("")
      setShowNewDocForm(false)
    } catch (error) {
      console.error("Failed to create document:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside className="panel p-4 lg:p-5">
      <div>
        <p className="section-title">Library</p>
        <h2 className="text-xl mt-2">Documents</h2>
      </div>

      <div className="mt-4">
        {showNewDocForm ? (
          <form onSubmit={handleCreateDocument} className="space-y-3">
            <input
              type="text"
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
              placeholder="Name this document"
              className="input"
              disabled={loading}
              aria-label="New document name"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={loading}
              >
                {loading ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-small"
                onClick={() => setShowNewDocForm(false)}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            className="btn btn-primary w-full"
            onClick={() => setShowNewDocForm(true)}
            type="button"
          >
            New document
          </button>
        )}
      </div>

      <div className="mt-5 space-y-2">
        {documents.length === 0 ? (
          <p className="text-muted text-sm">No documents yet.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li key={doc.id}>
                <button
                  className={`doc-item ${
                    selectedDocId === doc.id ? "doc-item-active" : ""
                  }`}
                  onClick={() => onSelectDocument(doc.id)}
                  type="button"
                >
                  <span className="doc-icon" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="20"
                      height="20"
                    >
                      <path d="M7 3h6l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                      <path d="M13 3v5h5" />
                    </svg>
                  </span>
                  <span className="text-sm font-medium text-left">
                    {doc.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

export default DocumentList
