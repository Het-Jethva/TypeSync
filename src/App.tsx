import React, { useEffect, useState } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import Dashboard from "./components/Dashboard"
import { AuthForm } from "./components/AuthForm"
import { auth } from "./firebase"
import { onAuthStateChanged } from "firebase/auth"

const ProtectedRoute: React.FC<{ children: JSX.Element }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  if (loading) return <p>Loading...</p>
  return isAuthenticated ? (
    children
  ) : (
    <Navigate
      to="/auth"
      replace
    />
  )
}

const App: React.FC = () => {
  return (
    <BrowserRouter>
      {/* Header removed */}
      <Routes>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/auth"
          element={<AuthForm />}
        />
        <Route
          path="*"
          element={
            <Navigate
              to="/dashboard"
              replace
            />
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
