"use client";

import React from "react";

type SparklineSkeletonProps = {
  minimal?: boolean;
  className?: string;
  staggeredFadeOut?: boolean;
  fadeOutDurationMs?: number;
  fadeOutStaggerMs?: number;
  barCount?: number;
};

const DETAILED_HEIGHTS = [32, 68, 44, 80, 56];
const MINIMAL_HEIGHTS = [30, 62, 46, 74, 52];

export function SparklineSkeleton({
  minimal = false,
  className = "",
  staggeredFadeOut = false,
  fadeOutDurationMs = 500,
  fadeOutStaggerMs = 250,
  barCount,
}: SparklineSkeletonProps) {
  const heights = minimal ? MINIMAL_HEIGHTS : DETAILED_HEIGHTS;
  const safeBarCount = Math.max(1, Math.min(barCount ?? heights.length, heights.length));
  const displayHeights = heights.slice(0, safeBarCount);
  const sizeClass = minimal ? "w-12 h-4" : "w-16 h-6";

  return (
    <div className={`flex items-end justify-between ${sizeClass} ${className}`.trim()} style={{ gap: "2px" }}>
      {displayHeights.map((height, index) => (
        <div
          key={index}
          className={`${staggeredFadeOut ? "sparkline-exit-bar" : "sparkline-wave-bar"} flex-1 bg-gradient-to-b from-border to-surface-2 border-t border-border`}
          style={{
            height: `${height}%`,
            ["--skeleton-wave-delay" as any]: `${index * 95}ms`,
            ["--skeleton-fade-out-delay" as any]: `${index * fadeOutStaggerMs}ms`,
            ["--skeleton-fade-out-duration" as any]: `${fadeOutDurationMs}ms`,
          }}
        />
      ))}
    </div>
  );
}
