export type Theme = "light" | "dark";

export function toggleTheme(
  currentTheme: Theme,
  setThemeState: (theme: Theme) => void
): void {
  const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";
  setThemeState(nextTheme);
  document.documentElement.classList.toggle("dark", nextTheme === "dark");
  localStorage.setItem("theme", nextTheme);
}
