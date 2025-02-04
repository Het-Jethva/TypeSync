import {
  ref,
  set,
  onValue,
  update,
  get,
  remove,
  DatabaseReference,
  Unsubscribe,
} from "firebase/database"
import { database } from "../firebase"

export interface User {
  email: string
  accessTime: string
}

export interface DocumentData {
  title: string
  content: string
  users: Record<string, User>
  lastModified: string
}

class DocumentService {
  private dbRef = ref(database, "documents")
  private documentRef: (documentId: string) => DatabaseReference

  constructor() {
    this.documentRef = (documentId: string) =>
      ref(database, `documents/${documentId}`)
  }

  private sanitizeEmail(email: string): string {
    return email.replace(/[.]/g, "_")
  }

  async createDocument(documentId: string, title: string): Promise<void> {
    const documentRef = this.documentRef(documentId)
    const snapshot = await get(documentRef)

    if (!snapshot.exists()) {
      const initialData: DocumentData = {
        title: title || "Untitled Document",
        content: "",
        users: {},
        lastModified: new Date().toISOString(),
      }
      await set(documentRef, initialData)
    }
  }

  async getAllDocuments() {
    return await get(this.dbRef)
  }

  async initializeDocument(
    documentId: string,
    title: string,
    initialContent: string = "Welcome to TypeSync!"
  ): Promise<void> {
    const snapshot = await get(this.documentRef(documentId))
    if (!snapshot.exists()) {
      const initialData: DocumentData = {
        title: title || "Untitled Document",
        content: initialContent,
        users: {},
        lastModified: new Date().toISOString(),
      }
      await set(this.documentRef(documentId), initialData)
    }
  }

  subscribeToDocument(
    documentId: string,
    callback: (data: DocumentData) => void
  ): Unsubscribe {
    return onValue(this.documentRef(documentId), (snapshot) => {
      const data = snapshot.val() as DocumentData
      if (data) {
        callback(data)
      }
    })
  }

  async updateTitle(documentId: string, newTitle: string): Promise<void> {
    try {
      await update(this.documentRef(documentId), {
        title: newTitle,
        lastModified: new Date().toISOString(),
      })
    } catch (error) {
      console.error("Error updating title:", error)
      throw error
    }
  }

  async updateContent(documentId: string, newContent: string): Promise<void> {
    try {
      await update(this.documentRef(documentId), {
        content: newContent,
        lastModified: new Date().toISOString(),
      })
    } catch (error) {
      console.error("Error updating content:", error)
      throw error
    }
  }

  async addUser(documentId: string, email: string): Promise<void> {
    if (!email || !email.includes("@")) {
      throw new Error("Invalid email address")
    }
    const sanitizedEmail = this.sanitizeEmail(email)
    const userData: User = {
      email: email,
      accessTime: new Date().toISOString(),
    }

    try {
      const snapshot = await get(this.documentRef(documentId))
      const currentData = (snapshot.val() as DocumentData) || { users: {} }

      await update(this.documentRef(documentId), {
        users: {
          ...currentData.users,
          [sanitizedEmail]: userData,
        },
      })
    } catch (error) {
      console.error("Error adding user:", error)
      throw error
    }
  }

  async removeUser(documentId: string, email: string): Promise<void> {
    const sanitizedEmail = this.sanitizeEmail(email)

    try {
      const snapshot = await get(this.documentRef(documentId))
      const currentData = snapshot.val() as DocumentData

      if (currentData && currentData.users) {
        const { [sanitizedEmail]: removedUser, ...remainingUsers } =
          currentData.users
        await update(this.documentRef(documentId), {
          users: remainingUsers,
        })
      }
    } catch (error) {
      console.error("Error removing user:", error)
      throw error
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    try {
      await remove(this.documentRef(documentId))
    } catch (error) {
      console.error("Error deleting document:", error)
      throw error
    }
  }
}

export const documentService = new DocumentService()
export default DocumentService
