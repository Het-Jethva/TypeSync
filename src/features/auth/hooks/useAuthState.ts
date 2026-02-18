import { useAuth } from "./useAuth"

export const useAuthState = () => {
  const { user, loading } = useAuth()
  return { user, loading }
}
