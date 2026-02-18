import { useEffect } from "react"
import { documentService } from "../documentService"
import { useAuth } from "../../auth/hooks/useAuth"

export const useDocumentAccess = (documentId: string) => {
  const { user } = useAuth()

  useEffect(() => {
    if (!user?.email) return
    documentService.addUser(documentId, user.email)
  }, [documentId, user?.email])
}
