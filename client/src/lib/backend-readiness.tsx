import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BackendReadinessContext,
  type BackendReadinessStatus,
} from "./backend-readiness-context";

const PROBE_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 2_500;
const DELAYED_AFTER_MS = 12_000;
const UNAVAILABLE_AFTER_MS = 45_000;

const configuredApiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
const readinessUrl = configuredApiUrl
  ? `${configuredApiUrl}/api/ready`
  : "/api/ready";

export function BackendReadinessProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [status, setStatus] = useState<BackendReadinessStatus>("waking");
  const [probeCycle, setProbeCycle] = useState(0);

  const retry = useCallback(() => {
    setStatus("waking");
    setProbeCycle((currentCycle) => currentCycle + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    let activeProbe: AbortController | undefined;
    let retryTimer: number | undefined;
    const startedAt = Date.now();

    const delayedTimer = window.setTimeout(() => {
      if (!cancelled && !stopped) {
        setStatus("delayed");
      }
    }, DELAYED_AFTER_MS);

    const unavailableTimer = window.setTimeout(() => {
      if (!cancelled) {
        stopped = true;
        activeProbe?.abort();
        setStatus("unavailable");
      }
    }, UNAVAILABLE_AFTER_MS);

    const probe = async () => {
      activeProbe = new AbortController();
      const probeTimeout = window.setTimeout(
        () => activeProbe?.abort(),
        PROBE_TIMEOUT_MS
      );

      try {
        const response = await fetch(readinessUrl, {
          cache: "no-store",
          signal: activeProbe.signal,
        });
        const body = (await response.json()) as { status?: string };

        if (!response.ok || body.status !== "ready") {
          throw new Error("Backend is not ready");
        }

        if (!cancelled && !stopped) {
          stopped = true;
          window.clearTimeout(delayedTimer);
          window.clearTimeout(unavailableTimer);
          setStatus("ready");
        }
      } catch {
        if (cancelled || stopped) return;

        const elapsed = Date.now() - startedAt;
        if (elapsed >= UNAVAILABLE_AFTER_MS) {
          stopped = true;
          setStatus("unavailable");
          return;
        }

        retryTimer = window.setTimeout(probe, RETRY_DELAY_MS);
      } finally {
        window.clearTimeout(probeTimeout);
      }
    };

    void probe();

    return () => {
      cancelled = true;
      activeProbe?.abort();
      window.clearTimeout(delayedTimer);
      window.clearTimeout(unavailableTimer);
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [probeCycle]);

  const value = useMemo(() => ({ status, retry }), [retry, status]);

  return (
    <BackendReadinessContext.Provider value={value}>
      {children}
    </BackendReadinessContext.Provider>
  );
}
