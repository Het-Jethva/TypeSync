import React, { useState, useRef, useEffect } from "react"
import { Editor } from "@tinymce/tinymce-react"
import { Editor as TinyMCEEditor } from "tinymce"
import DocumentService, {
  documentService,
  User,
  DocumentData,
} from "../services/documentService"

interface RTEProps {
  documentId: string
}

export const RTE: React.FC<RTEProps> = ({ documentId }) => {
  const [content, setContent] = useState<string>("")
  const [newUserEmail, setNewUserEmail] = useState<string>("")
  const [users, setUsers] = useState<Record<string, User>>({})
  const editorRef = useRef<TinyMCEEditor | null>(null)
  const skipNextUpdateRef = useRef(false)
  const changeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [feedback, setFeedback] = useState<string>("")

  useEffect(() => {
    const docService = new DocumentService()
    docService.initializeDocument(documentId, "Untitled Document")

    const unsubscribe = docService.subscribeToDocument(
      documentId,
      (data: DocumentData) => {
        if (skipNextUpdateRef.current) {
          skipNextUpdateRef.current = false
          return
        }

        setContent(data.content || "")
        setUsers(data.users || {})

        // Preserve cursor position when receiving updates
        const currentEditor = editorRef.current
        if (currentEditor) {
          const bookmark = currentEditor.selection.getBookmark(2, true)
          currentEditor.setContent(data.content || "")
          currentEditor.selection.moveToBookmark(bookmark)
        }
      }
    )

    return () => unsubscribe()
  }, [documentId])

  const handleEditorChange = (newContent: string) => {
    setContent(newContent)
    if (changeTimeoutRef.current) clearTimeout(changeTimeoutRef.current)
    changeTimeoutRef.current = setTimeout(async () => {
      try {
        await documentService.updateContent(documentId, newContent)
      } catch (error) {
        console.error("Error updating content:", error)
      }
    }, 500)
  }

  const handleAddUser = async () => {
    try {
      await documentService.addUser(documentId, newUserEmail)
      setFeedback(`User ${newUserEmail} added successfully!`)
      setNewUserEmail("")
      setTimeout(() => setFeedback(""), 3000)
    } catch (error) {
      setFeedback("Failed to add user. Please try again.")
      setTimeout(() => setFeedback(""), 3000)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      

      {/* Editor */}
      <Editor
        apiKey={import.meta.env.VITE_TINYMCE_API_KEY}
        onInit={(_, editor) => {
          editorRef.current = editor
        }}
        value={content}
        onEditorChange={handleEditorChange}
        init={{
          height: 500,
          plugins: [
            "anchor",
            "autolink",
            "charmap",
            "codesample",
            "emoticons",
            "image",
            "link",
            "lists",
            "media",
            "searchreplace",
            "table",
            "visualblocks",
            "wordcount",
            "checklist",
            "mediaembed",
            "casechange",
            "export",
            "formatpainter",
            "pageembed",
            "a11ychecker",
            "tinymcespellchecker",
            "permanentpen",
            "powerpaste",
            "advtable",
            "advcode",
            "editimage",
            "advtemplate",
            "mentions",
            "tableofcontents",
            "footnotes",
            "mergetags",
            "autocorrect",
            "typography",
            "inlinecss",
            "markdown",
            "importword",
            "exportword",
            "exportpdf",
          ],
          toolbar:
            "undo redo | blocks fontfamily fontsize | " +
            "bold italic underline strikethrough | " +
            "link image media table mergetags | " +
            "addcomment showcomments | " +
            "spellcheckdialog a11ycheck typography | " +
            "align lineheight | " +
            "checklist numlist bullist indent outdent | " +
            "emoticons charmap | removeformat",
          setup: (editor) => {
            editor.on("NodeChange", () => {
              // Preserve selection state
              const bookmark = editor.selection.getBookmark(2, true)
              editor.selection.moveToBookmark(bookmark)
            })
          },
        }}
      />
    </div>
  )
}

export default RTE
