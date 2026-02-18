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
import { database } from "../../lib/firebase"
import type { DocumentData, User } from "./types"

class DocumentService {
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
      if (data) callback(data)
    })
  }

  async updateTitle(documentId: string, newTitle: string): Promise<void> {
    await update(this.documentRef(documentId), {
      title: newTitle,
      lastModified: new Date().toISOString(),
    })
  }

  async updateContent(documentId: string, newContent: string): Promise<void> {
    await update(this.documentRef(documentId), {
      content: newContent,
      lastModified: new Date().toISOString(),
    })
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

    const documentRef = this.documentRef(documentId)
    const snapshot = await get(documentRef)

    if (!snapshot.exists()) {
      const initialData: DocumentData = {
        title: "Untitled Document",
        content: "Welcome to TypeSync!",
        users: {
          [sanitizedEmail]: userData,
        },
        lastModified: new Date().toISOString(),
      }
      await set(documentRef, initialData)
      return
    }

    const currentData = snapshot.val() as DocumentData

    await update(documentRef, {
      users: {
        ...(currentData.users || {}),
        [sanitizedEmail]: userData,
      },
    })
  }

  async removeUser(documentId: string, email: string): Promise<void> {
    const sanitizedEmail = this.sanitizeEmail(email)
    const snapshot = await get(this.documentRef(documentId))
    const currentData = snapshot.val() as DocumentData

    if (currentData && currentData.users) {
      const remainingUsers = { ...currentData.users }
      delete remainingUsers[sanitizedEmail]
      await update(this.documentRef(documentId), {
        users: remainingUsers,
      })
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await remove(this.documentRef(documentId))
  }
}

export const documentService = new DocumentService()
export default DocumentService
