import React, { useEffect, useRef, useState } from "react"
import { documentService } from "../documentService"
import type { DocumentData } from "../types"

interface DocumentDetailsProps {
  documentId: string
}

const DocumentDetails: React.FC<DocumentDetailsProps> = ({ documentId }) => {
  const [docData, setDocData] = useState<DocumentData | null>(null)
  const [newUserEmail, setNewUserEmail] = useState("")
  const [feedback, setFeedback] = useState("")
  const [feedbackType, setFeedbackType] = useState<"success" | "error" | null>(
    null
  )
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const unsubscribe = documentService.subscribeToDocument(
      documentId,
      (data: DocumentData) => {
        setDocData(data)
      }
    )
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current)
      }
      unsubscribe()
    }
  }, [documentId])

  const handleAddUser = async () => {
    const email = newUserEmail.trim()
    if (!email) return
    try {
      await documentService.addUser(documentId, email)
      setFeedback(`User ${email} added successfully!`)
      setFeedbackType("success")
      setNewUserEmail("")
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current)
      }
      feedbackTimeoutRef.current = setTimeout(() => {
        setFeedback("")
        setFeedbackType(null)
      }, 3000)
    } catch {
      setFeedback("Failed to add user. Please try again.")
      setFeedbackType("error")
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current)
      }
      feedbackTimeoutRef.current = setTimeout(() => {
        setFeedback("")
        setFeedbackType(null)
      }, 3000)
    }
  }

  return (
    <div className="space-y-4">
      {docData ? (
        <>
          <div className="card space-y-3">
            <div>
              <label className="section-title" htmlFor="share-email">
                Invite collaborator
              </label>
              <input
                id="share-email"
                type="email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="name@company.com"
                className="input mt-2"
              />
            </div>
            <button
              onClick={handleAddUser}
              className="btn btn-primary"
              type="button"
              disabled={!newUserEmail.trim()}
            >
              Send invite
            </button>
            {feedback && (
              <div
                className={`feedback ${
                  feedbackType === "error" ? "feedback-error" : ""
                }`}
                role="status"
              >
                {feedback}
              </div>
            )}
          </div>
          <div className="card">
            <h3 className="text-lg">Shared with</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.values(docData.users || {}).length > 0 ? (
                Object.values(docData.users || {}).map((user) => (
                  <div key={user.email} className="chip">
                    {user.email}
                  </div>
                ))
              ) : (
                <p className="text-muted text-sm">No collaborators yet.</p>
              )}
            </div>
          </div>
          <div className="card">
            <p className="text-sm">
              <span className="section-title">Last modified</span>
            </p>
            <p className="mt-2 text-sm">
              {docData.lastModified
                ? new Date(docData.lastModified).toLocaleString()
                : ""}
            </p>
          </div>
        </>
      ) : (
        <p className="text-muted">Loading...</p>
      )}
    </div>
  )
}

export default DocumentDetails
