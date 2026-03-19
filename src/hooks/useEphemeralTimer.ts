/**
 * GhostChat — Ephemeral Timer Hook
 * 
 * Countdown timer for ephemeral messages in the UI.
 */

import { useState, useEffect, useRef } from 'react';

/**
 * Hook that provides a countdown for ephemeral messages.
 * 
 * @param expiresAt - Unix timestamp when the message expires
 * @param onExpired - Callback when countdown reaches zero
 * @returns Remaining time in milliseconds
 */
export function useEphemeralTimer(
  expiresAt: number | null,
  onExpired?: () => void
): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }

    const update = () => {
      const now = Date.now();
      const left = expiresAt - now;
      
      if (left <= 0) {
        setRemaining(0);
        onExpiredRef.current?.();
        return false;
      }
      
      setRemaining(left);
      return true;
    };

    // Initial update
    if (!update()) return;

    // Update every second
    const interval = setInterval(() => {
      if (!update()) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}
