import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 3000,
  clientUrl: process.env.VITE_CLIENT_URL || "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL,
} as const;
