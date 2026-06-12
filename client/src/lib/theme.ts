import { flushSync } from "react-dom";

export function toggleThemeWithTransition(
  currentTheme: "light" | "dark",
  setThemeState: (theme: "light" | "dark") => void,
  event?: React.MouseEvent<HTMLButtonElement>
) {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";

  const doc = document as any;
  // Fallback if View Transitions API is not supported
  if (!doc.startViewTransition) {
    applyTheme(nextTheme, setThemeState);
    return;
  }

  // Get click coordinates, fallback to center of the screen if event is missing
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  if (event) {
    x = event.clientX;
    y = event.clientY;
  }

  // Calculate the radius to the furthest corner
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  // Set CSS variables on the document element for the reveal animation origin & radius
  document.documentElement.style.setProperty("--theme-x", `${x}px`);
  document.documentElement.style.setProperty("--theme-y", `${y}px`);
  document.documentElement.style.setProperty("--theme-r", `${endRadius}px`);

  // Disable CSS transitions temporarily to prevent them from interfering with the snapshots
  document.documentElement.classList.add("no-transitions");

  const transition = doc.startViewTransition(() => {
    // flushSync is required for React 18/19 so that state changes are committed to the DOM immediately
    flushSync(() => {
      applyTheme(nextTheme, setThemeState);
    });
  });

  // Re-enable transitions once the transition has finished (or if it fails/cancels)
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
