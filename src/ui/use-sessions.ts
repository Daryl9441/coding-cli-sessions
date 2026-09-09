import { useEffect, useState } from "react";
import { client, Snapshot } from "./client";

/** Memory only: never use cached hooks for prompts or output. */
export function useSessions(): { data: Snapshot; error?: string; isLoading: boolean } {
  const [data, setData] = useState<Snapshot>({ tasks: [], observed: [] });
  const [error, setError] = useState<string>();
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout;
    const poll = async () => {
      try {
        const result = await client.list();
        if (!cancelled) {
          setData(result);
          setError(undefined);
        }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to read local sessions");
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(() => {
            void poll();
          }, 1500);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return { data, error, isLoading };
}
