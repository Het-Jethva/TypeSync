import React from "react"
import { Navigate } from "react-router-dom"
import { useAuthState } from "../features/auth/hooks"

interface ProtectedRouteProps {
  children: JSX.Element
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuthState()

  if (loading) return <p>Loading...</p>
  return user ? children : <Navigate to="/auth/signin" replace />
}

export default ProtectedRoute
