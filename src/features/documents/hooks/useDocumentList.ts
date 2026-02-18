import { useEffect, useState } from "react"
import { ref, onValue } from "firebase/database"
import { database } from "../../../lib/firebase"
import { useAuth } from "../../auth/hooks/useAuth"
import type { DocumentData, DocumentListItem } from "../types"

const sanitizeEmail = (email: string): string => email.replace(/[.]/g, "_")

export const useDocumentList = () => {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    if (!user?.email) {
      setDocuments([])
      return
    }
    const sanitizedEmail = sanitizeEmail(user.email)
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
  }, [loading, user?.email])

  return { documents }
}
