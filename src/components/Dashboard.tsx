import React, { useState, useEffect, FormEvent } from "react"
import { documentService } from "../services/documentService"
import RTE from "./RTE"
import { v4 as uuidv4 } from "uuid"
import { auth } from "../firebase"
import { ref, onValue } from "firebase/database"
import { database } from "../firebase"

interface DocumentListItem {
  id: string
  name: string
}

import { DocumentData } from "../services/documentService"

const Dashboard: React.FC = () => {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showNewDocForm, setShowNewDocForm] = useState<boolean>(false)
  const [newDocName, setNewDocName] = useState<string>("")

  useEffect(() => {
    const currentUser = auth.currentUser
    if (!currentUser?.email) return
    const sanitizedEmail = currentUser.email.replace(/[.]/g, "_")
    const documentsRef = ref(database, "documents")
    const unsubscribe = onValue(documentsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val() as Record<string, DocumentData>
        const docList = Object.keys(data)
          .filter((key) => data[key].users && data[key].users[sanitizedEmail])
          .map((key) => ({
            id: key,
            name: data[key].title || key.replace(/_/g, " "),
          }))
        setDocuments(docList)
      } else {
        setDocuments([])
      }
    })
    return () => unsubscribe()
  }, [])

  const handleCreateDocument = async (e: FormEvent) => {
    e.preventDefault()
    if (!newDocName.trim()) return
    setLoading(true)
    const newDocId = uuidv4()
    await documentService.createDocument(newDocId, newDocName.trim())
    // Add current user to the new document
    const currentUser = auth.currentUser
    if (currentUser?.email) {
      await documentService.addUser(newDocId, currentUser.email)
    }
    setDocuments((prev) => [...prev, { id: newDocId, name: newDocName.trim() }])
    setSelectedDocId(newDocId)
    setNewDocName("")
    setShowNewDocForm(false)
    setLoading(false)
  }

  return (
    <div className="flex h-screen">
      {/* Left Panel - Document List */}
      <div className="w-1/6 bg-gray-100 p-4 border-r overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Documents</h2>
        {showNewDocForm ? (
          <form
            onSubmit={handleCreateDocument}
            className="mb-4"
          >
            <input
              type="text"
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
              placeholder="Document name"
              className="w-full px-2 py-1 border rounded mb-2"
              disabled={loading}
            />
            <button
              type="submit"
              className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Document"}
            </button>
          </form>
        ) : (
          <button
            className="w-full bg-blue-500 text-white p-2 rounded mb-4 hover:bg-blue-600"
            onClick={() => setShowNewDocForm(true)}
          >
            New Document
          </button>
        )}
        {documents.length === 0 ? (
          <p className="text-gray-500">No documents available</p>
        ) : (
          <ul>
            {documents.map((doc) => (
              <li
                key={doc.id}
                className={`p-2 cursor-pointer rounded transition-colors duration-200 ${
                  selectedDocId === doc.id
                    ? "bg-blue-300 text-black"
                    : "hover:bg-gray-200"
                }`}
                onClick={() => setSelectedDocId(doc.id)}
              >
                {doc.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Middle Panel - Editor */}
      <div className="w-4/6 p-4">
        {selectedDocId ? (
          <RTE documentId={selectedDocId} />
        ) : (
          <p className="text-gray-500">Select or create a document</p>
        )}
      </div>

      {/* Right Panel - Document Info */}
      <div className="w-1/6 bg-gray-100 p-4 border-l overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">Document Details</h2>
        {selectedDocId ? (
          <DocumentDetails documentId={selectedDocId} />
        ) : (
          <p className="text-gray-500">No document selected</p>
        )}
      </div>
    </div>
  )
}

// Document Details Component
const DocumentDetails: React.FC<{ documentId: string }> = ({ documentId }) => {
  const [docData, setDocData] = useState<DocumentData | null>(null)
  const [newUserEmail, setNewUserEmail] = useState("")
  const [feedback, setFeedback] = useState("")

  useEffect(() => {
    const unsubscribe = documentService.subscribeToDocument(
      documentId,
      (data: DocumentData) => {
        setDocData(data)
      }
    )
    return () => unsubscribe()
  }, [documentId])

  const handleAddUser = async () => {
    try {
      await documentService.addUser(documentId, newUserEmail)
      setFeedback(`User ${newUserEmail} added successfully!`)
      setNewUserEmail("")
      setTimeout(() => setFeedback(""), 3000)
    } catch {
      setFeedback("Failed to add user. Please try again.")
      setTimeout(() => setFeedback(""), 3000)
    }
  }

  return (
    <div className="bg-white p-4 rounded shadow">
      {docData ? (
        <>
          {/* User Management Section */}
          <div className="mb-4">
            <input
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="Enter user email"
              className="w-full px-3 py-2 border rounded mb-2"
            />
            <button
              onClick={handleAddUser}
              className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Add User
            </button>
          </div>
          {feedback && (
            <div className="text-green-600 text-sm mb-4">{feedback}</div>
          )}
          {/* Active Users List */}
          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-2">Shared with:</h3>
            <div className="flex flex-wrap gap-2">
              {Object.values(docData.users || {}).map((user) => (
                <div
                  key={user.email}
                  className="px-3 py-1 bg-gray-100 rounded-full text-sm"
                >
                  {user.email}
                </div>
              ))}
            </div>
          </div>
          <p>
            <strong>Last Modified:</strong>{" "}
            {docData.lastModified
              ? new Date(docData.lastModified).toLocaleString()
              : ""}
          </p>
        </>
      ) : (
        <p>Loading...</p>
      )}
    </div>
  )
}

export default Dashboard
