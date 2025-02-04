import { auth } from "../firebase"
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  UserCredential,
  User,
} from "firebase/auth"

interface AuthError extends Error {
  message: string
}

const validateCredentials = (email: string, password: string): void => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email || !emailRegex.test(email)) {
    throw new Error("Invalid email format")
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new Error("Password must be at least 6 characters")
  }
}

export const signUp = async (
  email: string,
  password: string
): Promise<User> => {
  try {
    validateCredentials(email, password)
    const userCredential: UserCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    )
    return userCredential.user
  } catch (error: unknown) {
    const authError = error as AuthError
    throw new Error(`Authentication Error: ${authError.message}`)
  }
}

export const signIn = async (
  email: string,
  password: string
): Promise<User> => {
  try {
    validateCredentials(email, password)
    const userCredential: UserCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    )
    return userCredential.user
  } catch (error: unknown) {
    const authError = error as AuthError
    throw new Error(`Authentication Error: ${authError.message}`)
  }
}

export const logOut = async (): Promise<boolean> => {
  try {
    await signOut(auth)
    return true
  } catch (error: unknown) {
    const authError = error as AuthError
    throw new Error(`Authentication Error: ${authError.message}`)
  }
}
