import React from "react"
import { useDocumentList, useSelectedDocument } from "../hooks"
import { DocumentList, DocumentDetails, EditorPanel } from "../components"

const DashboardPage: React.FC = () => {
  const { selectedDocId, setSelectedDocId } = useSelectedDocument()
  const { documents } = useDocumentList()

  return (
    <div className="app-shell">
      <div className="app-container">
        <header className="panel p-4 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl">TypeSync</h1>
              <p className="text-muted text-sm">
                A simple space to write and share documents.
              </p>
            </div>
            <div className="chip">Live sync</div>
          </div>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
          <DocumentList
            documents={documents}
            selectedDocId={selectedDocId}
            onSelectDocument={setSelectedDocId}
          />

          <EditorPanel documentId={selectedDocId} />

          <section className="panel p-4 lg:p-5">
            <div>
              <p className="section-title">Details</p>
              <h2 className="text-xl mt-2">Document details</h2>
            </div>
            <div className="mt-4">
              {selectedDocId ? (
                <DocumentDetails documentId={selectedDocId} />
              ) : (
                <div className="card">
                  <p className="text-muted text-sm">
                    No document selected.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
