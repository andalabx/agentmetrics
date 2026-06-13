import { useEffect, useRef } from "react";

export default function usePolling(callback, intervalMs = 30_000) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const tick = () => savedCallback.current();
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
