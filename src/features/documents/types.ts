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

export interface DocumentListItem {
  id: string
  name: string
}
