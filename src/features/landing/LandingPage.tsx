import React from "react"
import { Link } from "react-router-dom"
import { useAuthState } from "../auth/hooks"

const LandingPage: React.FC = () => {
  const { user } = useAuthState()
  const authLinks = {
    signIn: "/auth/signin",
    signUp: "/auth/signup",
  }
  const primaryCta = user
    ? { label: "Go to dashboard", to: "/dashboard" }
    : { label: "Start writing", to: authLinks.signUp }

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-container landing-header-inner">
          <div className="landing-brand">
            <span className="landing-mark">TS</span>
            <span className="landing-wordmark">TypeSync</span>
          </div>
          <nav className="landing-nav" aria-label="Primary">
            <a className="landing-nav-link" href="#features">
              Features
            </a>
            <a className="landing-nav-link" href="#workflow">
              Workflow
            </a>
            <a className="landing-nav-link" href="#platform">
              Platform
            </a>
          </nav>
          <div className="landing-actions">
            {!user && (
              <Link to={authLinks.signIn} className="btn btn-ghost">
                Sign in
              </Link>
            )}
            <Link to={primaryCta.to} className="btn btn-primary">
              {primaryCta.label}
            </Link>
          </div>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-container landing-hero-grid">
            <div className="landing-hero-copy">
              <div className="landing-pill">Live collaborative documents</div>
              <h1 className="landing-title">A calmer place to write together.</h1>
              <p className="landing-lede">
                TypeSync keeps your team in sync with low latency updates,
                shared access, and a focused editor that stays out of the way.
              </p>
              <div className="landing-hero-actions">
                <Link to={primaryCta.to} className="btn btn-primary">
                  {primaryCta.label}
                </Link>
                {!user && (
                  <a href="#workflow" className="btn btn-outline">
                    See collaboration flow
                  </a>
                )}
              </div>
              <div className="landing-stats">
                <div>
                  <p className="landing-stat-value">500ms</p>
                  <p className="landing-stat-label">sync cadence</p>
                </div>
                <div>
                  <p className="landing-stat-value">Realtime</p>
                  <p className="landing-stat-label">updates and presence</p>
                </div>
                <div>
                  <p className="landing-stat-value">Shared</p>
                  <p className="landing-stat-label">invite collaborators</p>
                </div>
              </div>
            </div>
            <div className="landing-hero-preview">
              <div className="landing-doc-card">
                <div className="landing-doc-header">
                  <div>
                    <p className="landing-doc-title">Product brief</p>
                    <p className="landing-doc-subtitle">Sprint 12 kickoff</p>
                  </div>
                  <span className="landing-doc-chip">Shared</span>
                </div>
                <div className="landing-doc-lines" aria-hidden="true">
                  <span className="landing-line long" />
                  <span className="landing-line medium" />
                  <span className="landing-line long" />
                  <span className="landing-line short" />
                </div>
                <div className="landing-doc-footer">
                  <div className="landing-avatars" aria-label="Collaborators">
                    <span className="landing-avatar">AL</span>
                    <span className="landing-avatar">NK</span>
                    <span className="landing-avatar">RS</span>
                  </div>
                  <div className="landing-sync">
                    <span className="landing-sync-dot" aria-hidden="true" />
                    Syncing
                  </div>
                </div>
              </div>
              <div className="landing-note-card">
                <p className="landing-note-title">Live cursor</p>
                <p className="landing-note-body">
                  See edits as they happen with no refresh or merge conflicts.
                </p>
                <div className="landing-note-signal">
                  <span className="landing-note-dot" aria-hidden="true" />
                  typing
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="landing-section">
          <div className="landing-container">
            <div className="landing-section-header">
              <p className="section-title">Features</p>
              <h2 className="landing-section-title">
                Everything you need to keep documents moving.
              </h2>
              <p className="landing-section-body">
                Create documents, invite collaborators, and edit together in a
                clean workspace that keeps attention on the words.
              </p>
            </div>
            <div className="landing-bento">
              <article className="landing-card landing-card-wide">
                <div className="landing-card-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M4 6h10l6 6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M14 6v6h6"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <h3 className="landing-card-title">Structured library</h3>
                <p className="landing-card-body">
                  Your documents stay organized in one list so the team can
                  jump between drafts without hunting for links.
                </p>
              </article>
              <article className="landing-card">
                <div className="landing-card-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M12 3v18"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M5 12h14"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <h3 className="landing-card-title">Realtime editing</h3>
                <p className="landing-card-body">
                  Changes flow in quickly so everyone stays aligned without
                  manual refresh.
                </p>
              </article>
              <article className="landing-card landing-card-accent">
                <div className="landing-card-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path
                      d="M7 7a4 4 0 0 1 7.5-1.5"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M6 16a4 4 0 0 0 7.8 1"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M16 9h3v3"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M5 12h14"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <h3 className="landing-card-title">Invite collaborators</h3>
                <p className="landing-card-body">
                  Share by email and keep track of who has access in the
                  document details panel.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section id="workflow" className="landing-section landing-workflow">
          <div className="landing-container landing-workflow-grid">
            <div>
              <p className="section-title">Workflow</p>
              <h2 className="landing-section-title">
                From draft to shared workspace in minutes.
              </h2>
              <p className="landing-section-body">
                Build a writing rhythm that keeps everyone in sync without
                interrupting focus.
              </p>
              <ol className="landing-steps">
                <li className="landing-step">
                  <span className="landing-step-index">01</span>
                  <div>
                    <p className="landing-step-title">Create a document</p>
                    <p className="landing-step-body">
                      Name a new draft and start writing immediately.
                    </p>
                  </div>
                </li>
                <li className="landing-step">
                  <span className="landing-step-index">02</span>
                  <div>
                    <p className="landing-step-title">Invite collaborators</p>
                    <p className="landing-step-body">
                      Add teammates by email and keep them listed in the
                      details pane.
                    </p>
                  </div>
                </li>
                <li className="landing-step">
                  <span className="landing-step-index">03</span>
                  <div>
                    <p className="landing-step-title">Edit in sync</p>
                    <p className="landing-step-body">
                      Updates flow in live so everyone stays aligned.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="landing-workflow-panel">
              <h3 className="landing-panel-title">Collaboration rhythm</h3>
              <div className="landing-panel-row">
                <span>Active editors</span>
                <span className="landing-panel-value">3</span>
              </div>
              <div className="landing-panel-row">
                <span>Sync interval</span>
                <span className="landing-panel-value">0.5s</span>
              </div>
              <div className="landing-panel-row">
                <span>Last update</span>
                <span className="landing-panel-value">Now</span>
              </div>
              <div className="landing-panel-divider" />
              <p className="landing-panel-body">
                Stay focused while TypeSync keeps the document consistent and
                ready to share.
              </p>
            </div>
          </div>
        </section>

        <section id="platform" className="landing-section">
          <div className="landing-container landing-security-grid">
            <div>
              <p className="section-title">Platform</p>
              <h2 className="landing-section-title">
                Built on Firebase for authentication and realtime storage.
              </h2>
              <p className="landing-section-body">
                Use familiar Firebase services to power secure sign in and
                low-latency updates while keeping configuration in your own
                environment.
              </p>
            </div>
            <div className="landing-security-card">
              <div className="landing-check">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    d="M5 12l4 4 10-10"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <p className="landing-check-title">Firebase Auth</p>
                  <p className="landing-check-body">
                    Email sign in keeps access simple and familiar.
                  </p>
                </div>
              </div>
              <div className="landing-check">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    d="M5 12l4 4 10-10"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <p className="landing-check-title">Realtime Database</p>
                  <p className="landing-check-body">
                    Document updates stream directly to every collaborator.
                  </p>
                </div>
              </div>
              <div className="landing-check">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    d="M5 12l4 4 10-10"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <p className="landing-check-title">Configurable keys</p>
                  <p className="landing-check-body">
                    Environment based configuration keeps credentials out of
                    your codebase.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-container landing-cta-card">
            <div>
              <p className="section-title">Ready to write</p>
              <h2 className="landing-cta-title">Bring the team into sync.</h2>
              <p className="landing-section-body">
                Start a document, share the link, and keep momentum.
              </p>
            </div>
            <div className="landing-cta-actions">
              <Link to={primaryCta.to} className="btn btn-primary">
                {primaryCta.label}
              </Link>
              {!user && (
                <Link to={authLinks.signIn} className="btn btn-outline">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div>
            <p className="landing-footer-brand">TypeSync</p>
            <p className="landing-footer-note">
              Realtime documents for focused teams.
            </p>
          </div>
          <div className="landing-footer-links">
            <a href="#features">Features</a>
            <a href="#workflow">Workflow</a>
            <a href="#platform">Platform</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
