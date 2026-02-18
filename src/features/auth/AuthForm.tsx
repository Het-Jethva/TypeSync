import React, { useState, useEffect, FormEvent, ChangeEvent } from "react"
import { signUp, signIn } from "./authService"
import { useNavigate, useParams } from "react-router-dom"

const AuthForm: React.FC = () => {
  const navigate = useNavigate()
  const { mode } = useParams()
  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [isSignIn, setIsSignIn] = useState<boolean>(true)
  const [error, setError] = useState<string>("")
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    if (mode === "signup") {
      setIsSignIn(false)
    } else if (mode === "signin") {
      setIsSignIn(true)
    } else if (mode) {
      navigate("/auth/signin", { replace: true })
    }
  }, [mode, navigate])

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
    const nextIsSignIn = !isSignIn
    setIsSignIn(nextIsSignIn)
    setEmail("")
    setPassword("")
    setError("")
    navigate(
      nextIsSignIn ? "/auth/signin" : "/auth/signup",
      {
        replace: true,
      }
    )
  }

  const handleEmailChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setEmail(e.target.value)
  }

  const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setPassword(e.target.value)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <section className="panel w-full max-w-md p-6 lg:p-8">
        <div>
          <p className="section-title">TypeSync</p>
          <h1 className="text-2xl mt-2">
            {isSignIn ? "Sign in" : "Create your account"}
          </h1>
          <p className="text-muted text-sm mt-2">
            Use your email to access your documents.
          </p>
        </div>

        {error && (
          <div
            className="mt-4 text-sm text-red-600"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="section-title">
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={handleEmailChange}
              className="input mt-2"
              required
              aria-label="Email address"
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor="password" className="section-title">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={handlePasswordChange}
              className="input mt-2"
              required
              aria-label="Password"
              disabled={isLoading}
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className={`btn btn-primary w-full ${
              isLoading ? "opacity-60 cursor-not-allowed" : ""
            }`}
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : isSignIn ? "Sign in" : "Sign up"}
          </button>
        </form>

        <div className="mt-6 text-sm text-muted">
          {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={toggleMode}
            className="btn btn-ghost btn-small"
            disabled={isLoading}
            type="button"
          >
            {isSignIn ? "Sign up" : "Sign in"}
          </button>
        </div>
      </section>
    </div>
  )
}

export { AuthForm }
export default AuthForm
