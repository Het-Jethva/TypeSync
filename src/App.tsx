import React, { Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { ProtectedRoute } from "./components"

const LandingPage = React.lazy(() => import("./features/landing/LandingPage"))
const DashboardPage = React.lazy(
  () => import("./features/documents/pages/DashboardPage")
)
const AuthForm = React.lazy(() => import("./features/auth/AuthForm"))

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Suspense fallback={<p>Loading...</p>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/auth"
            element={<Navigate to="/auth/signin" replace />}
          />
          <Route path="/auth/:mode" element={<AuthForm />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
