import { flushSync } from "react-dom";

export function toggleThemeWithTransition(
  currentTheme: "light" | "dark",
  setThemeState: (theme: "light" | "dark") => void,
  event?: React.MouseEvent<HTMLButtonElement>
) {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";

  // Reduced-motion users receive the theme change without a radial reveal.
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    typeof document.startViewTransition !== "function"
  ) {
    applyTheme(nextTheme, setThemeState);
    return;
  }

  const x = event?.clientX ?? window.innerWidth / 2;
  const y = event?.clientY ?? window.innerHeight / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  document.documentElement.style.setProperty("--theme-x", `${x}px`);
  document.documentElement.style.setProperty("--theme-y", `${y}px`);
  document.documentElement.style.setProperty("--theme-r", `${endRadius}px`);
  document.documentElement.classList.add("no-transitions");

  const transition = document.startViewTransition(() => {
    // flushSync commits the theme class before the browser snapshots the new tree.
    flushSync(() => {
      applyTheme(nextTheme, setThemeState);
    });
  });

  transition.finished.finally(() => {
    document.documentElement.classList.remove("no-transitions");
  });
}

function applyTheme(
  nextTheme: "light" | "dark",
  setThemeState: (theme: "light" | "dark") => void
) {
  setThemeState(nextTheme);
  if (nextTheme === "dark") {
    document.documentElement.classList.add("dark");
    localStorage.setItem("theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    localStorage.setItem("theme", "light");
  }
}
