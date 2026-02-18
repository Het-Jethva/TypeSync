import { useEffect, useRef, useState } from "react"
import DocumentService, { documentService } from "../documentService"

export const useDocumentSync = (documentId: string) => {
  const [content, setContent] = useState<string>("")
  const skipNextUpdateRef = useRef(false)
  const changeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const docService = new DocumentService()
    docService.initializeDocument(documentId, "Untitled Document")

    const unsubscribe = docService.subscribeToDocument(documentId, (data) => {
      if (skipNextUpdateRef.current) {
        skipNextUpdateRef.current = false
        return
      }
      setContent(data.content || "")
    })

    return () => {
      if (changeTimeoutRef.current) clearTimeout(changeTimeoutRef.current)
      unsubscribe()
    }
  }, [documentId])

  const queueContentUpdate = (newContent: string) => {
    setContent(newContent)
    if (changeTimeoutRef.current) clearTimeout(changeTimeoutRef.current)
    changeTimeoutRef.current = setTimeout(async () => {
      try {
        await documentService.updateContent(documentId, newContent)
      } catch (err) {
        console.error("Error updating content:", err)
      }
    }, 500)
  }

  const markNextUpdateFromLocal = () => {
    skipNextUpdateRef.current = true
  }

  return {
    content,
    queueContentUpdate,
    markNextUpdateFromLocal,
  }
}
