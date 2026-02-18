import { useState } from "react"

export const useSelectedDocument = () => {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  return {
    selectedDocId,
    setSelectedDocId,
  }
}
