/**
 * GhostChat — Identicon Generator
 * 
 * Generates unique visual identities from PeerID hashes.
 * No external images needed — pure SVG from deterministic hashing.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/** Color palette for identicons — ghost-themed */
const PALETTE = [
  '#7c6aff', '#a78bfa', '#c4b5fd', '#6ee7b7', '#34d399',
  '#f472b6', '#fb7185', '#fbbf24', '#60a5fa', '#818cf8',
  '#f97316', '#38bdf8', '#e879f9', '#4ade80', '#f43f5e',
  '#a855f7', '#ec4899', '#14b8a6', '#8b5cf6', '#06b6d4',
];

interface IdenticonProps {
  peerId: string;
  size?: number;
  className?: string;
}

/**
 * React component that renders a unique identicon SVG.
 */
export function Identicon({ peerId, size = 40, className = '' }: IdenticonProps) {
  const hash = bytesToHex(sha256(new TextEncoder().encode(peerId)));
  const colors = getColors(hash);
  const pattern = getPattern(hash);
  
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      className={className}
      style={{ borderRadius: '50%', overflow: 'hidden' }}
    >
      {/* Background */}
      <rect width="10" height="10" fill={colors.bg} />
      
      {/* Symmetric 5x5 pattern */}
      {pattern.map((row, y) =>
        row.map((active, x) =>
          active ? (
            <rect
              key={`${x}-${y}`}
              x={x * 2}
              y={y * 2}
              width="2"
              height="2"
              fill={colors.fg}
              opacity={0.85 + (parseInt(hash[x + y], 16) / 60)}
            />
          ) : null
        )
      )}
    </svg>
  );
}

/**
 * Get deterministic colors from hash.
 */
function getColors(hash: string): { bg: string; fg: string } {
  const bgIdx = parseInt(hash.slice(0, 2), 16) % PALETTE.length;
  const fgIdx = (parseInt(hash.slice(2, 4), 16) % (PALETTE.length - 1) + bgIdx + 1) % PALETTE.length;
  
  return {
    bg: PALETTE[bgIdx] + '30', // 30% opacity background
    fg: PALETTE[fgIdx],
  };
}

/**
 * Generate symmetric 5x5 pattern from hash.
 * Only left half + center column are generated, then mirrored.
 */
function getPattern(hash: string): boolean[][] {
  const grid: boolean[][] = [];
  
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 5; x++) {
      // Mirror: x=0↔4, x=1↔3, x=2 is center
      const mirrorX = x <= 2 ? x : 4 - x;
      const idx = y * 3 + mirrorX;
      const charIdx = (idx * 2 + 4) % hash.length;
      row.push(parseInt(hash[charIdx], 16) > 7);
    }
    grid.push(row);
  }
  
  return grid;
}
