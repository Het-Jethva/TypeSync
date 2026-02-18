const requiredEnv = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_DATABASE_URL",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_MEASUREMENT_ID",
  "VITE_TINYMCE_API_KEY",
] as const

type RequiredEnvKey = (typeof requiredEnv)[number]

const readEnv = (key: RequiredEnvKey) =>
  (import.meta.env[key] || "").toString().trim()

export const env = {
  firebaseApiKey: readEnv("VITE_FIREBASE_API_KEY"),
  firebaseAuthDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  firebaseDatabaseUrl: readEnv("VITE_FIREBASE_DATABASE_URL"),
  firebaseProjectId: readEnv("VITE_FIREBASE_PROJECT_ID"),
  firebaseStorageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  firebaseMessagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  firebaseAppId: readEnv("VITE_FIREBASE_APP_ID"),
  firebaseMeasurementId: readEnv("VITE_FIREBASE_MEASUREMENT_ID"),
  tinymceApiKey: readEnv("VITE_TINYMCE_API_KEY") || "no-api-key",
} as const

export const getMissingEnv = () =>
  requiredEnv.filter((key) => !readEnv(key))
