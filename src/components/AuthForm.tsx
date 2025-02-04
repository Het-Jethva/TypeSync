import React, { useState, useEffect, FormEvent, ChangeEvent } from "react"
import { signUp, signIn } from "../services/authService"
import { useNavigate } from "react-router-dom"

export const AuthForm: React.FC = () => {
  const navigate = useNavigate()
  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [isSignIn, setIsSignIn] = useState<boolean>(true)
  const [error, setError] = useState<string>("")
  const [isLoading, setIsLoading] = useState<boolean>(false)

  // Clear error when switching modes
  useEffect(() => {
    setError("")
  }, [isSignIn])

  const validateForm = (): boolean => {
    if (!email.includes("@") || !email.includes(".")) {
      setError("Please enter a valid email address")
      return false
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long")
      return false
    }
    return true
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!validateForm()) return

    setIsLoading(true)
    setError("")

    try {
      if (isSignIn) {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
      // Redirect to dashboard after successful login/signup
      navigate("/dashboard")
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Authentication failed. Please try again."
      )
    } finally {
      setIsLoading(false)
    }
  }

  const toggleMode = (): void => {
    setIsSignIn(!isSignIn)
    setEmail("")
    setPassword("")
    setError("")
  }

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setEmail(e.target.value)
  }

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setPassword(e.target.value)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-md bg-white p-8 rounded-md shadow-md">
        <h1 className="text-2xl font-semibold text-center mb-6">
          {isSignIn ? "Sign In" : "Sign Up"}
        </h1>

        {error && (
          <div
            className="mb-4 text-sm text-red-500"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="mb-4">
            <label
              htmlFor="email"
              className="block text-gray-700 font-medium mb-2"
            >
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={handleEmailChange}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring focus:ring-blue-200"
              required
              aria-label="Email address"
              disabled={isLoading}
            />
          </div>

          <div className="mb-4">
            <label
              htmlFor="password"
              className="block text-gray-700 font-medium mb-2"
            >
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={handlePasswordChange}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring focus:ring-blue-200"
              required
              aria-label="Password"
              disabled={isLoading}
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className={`w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring focus:ring-blue-200 ${
              isLoading ? "opacity-50 cursor-not-allowed" : ""
            }`}
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : isSignIn ? "Sign In" : "Sign Up"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <p className="text-sm text-gray-600">
            {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              onClick={toggleMode}
              className="text-blue-500 hover:underline focus:outline-none"
              disabled={isLoading}
              type="button"
            >
              {isSignIn ? "Sign Up" : "Sign In"}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
