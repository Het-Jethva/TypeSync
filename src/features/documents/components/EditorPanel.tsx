import React, { Suspense } from "react"

const RTE = React.lazy(() => import("../RTE"))

interface EditorPanelProps {
  documentId: string | null
}

const EditorPanel: React.FC<EditorPanelProps> = ({ documentId }) => {
  return (
    <section className="panel p-4 lg:p-5">
      <div>
        <p className="section-title">Workspace</p>
        <h2 className="text-xl mt-2">Editor</h2>
      </div>

      <div className="mt-4 editor-frame">
        {documentId ? (
          <Suspense fallback={<p className="text-muted">Loading editor...</p>}>
            <RTE documentId={documentId} />
          </Suspense>
        ) : (
          <div className="card">
            <h3 className="text-lg">Pick a document</h3>
            <p className="text-muted text-sm mt-2">
              Select a document from the library or create a new one to start
              writing.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

export default EditorPanel
