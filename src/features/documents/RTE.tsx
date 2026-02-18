import React, { useRef } from "react"
import { Editor } from "@tinymce/tinymce-react"
import { Editor as TinyMCEEditor } from "tinymce"
import { useDocumentAccess, useDocumentSync } from "./hooks"
import { editorConfig } from "./constants"
import { env } from "../../lib/env"

interface RTEProps {
  documentId: string
}

export const RTE: React.FC<RTEProps> = ({ documentId }) => {
  const editorRef = useRef<TinyMCEEditor | null>(null)
  const { content, queueContentUpdate, markNextUpdateFromLocal } =
    useDocumentSync(documentId)
  useDocumentAccess(documentId)

  const handleEditorChange = (newContent: string) => {
    markNextUpdateFromLocal()
    queueContentUpdate(newContent)
  }

  return (
    <div className="flex flex-col gap-4">
      <Editor
        apiKey={env.tinymceApiKey}
        onInit={(_, editor) => {
          editorRef.current = editor
        }}
        value={content}
        onEditorChange={handleEditorChange}
        init={{
          ...editorConfig,
          content_style:
            "body { font-family: 'Instrument Sans', Arial, sans-serif; font-size: 16px; color: #1c1c18; line-height: 1.6; } h1, h2, h3 { font-weight: 600; letter-spacing: -0.01em; }",
          setup: (editor) => {
            editor.on("NodeChange", () => {
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
