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
    <>
      <div className={`flex items-end justify-between ${sizeClass} ${className}`.trim()} style={{ gap: "2px" }}>
        {displayHeights.map((height, index) => (
          <div
            key={index}
            className={`${staggeredFadeOut ? "exitBar" : "waveBar"} flex-1 rounded-xs bg-gradient-to-b from-muted-50 to-muted-20 border-t border-muted-foreground/40`}
            style={{
              height: `${height}%`,
              ["--skeleton-wave-delay" as any]: `${index * 95}ms`,
              ["--skeleton-fade-out-delay" as any]: `${index * fadeOutStaggerMs}ms`,
              ["--skeleton-fade-out-duration" as any]: `${fadeOutDurationMs}ms`,
            }}
          />
        ))}
      </div>

      <style jsx>{`
        .waveBar {
          transform-origin: bottom center;
          animation: sparklineWave 900ms cubic-bezier(0.4, 0, 0.2, 1) infinite;
          animation-delay: var(--skeleton-wave-delay, 0ms);
          will-change: transform, opacity;
        }

        .exitBar {
          transform-origin: bottom center;
          animation: skeletonStaggeredFadeOut var(--skeleton-fade-out-duration, 500ms) cubic-bezier(0.4, 0, 0.2, 1) forwards;
          animation-delay: var(--skeleton-fade-out-delay, 0ms);
          will-change: transform, opacity;
        }

        @keyframes sparklineWave {
          0%,
          100% {
            transform: scaleY(0.35);
            opacity: 0.35;
          }
          25% {
            transform: scaleY(1);
            opacity: 0.95;
          }
          50% {
            transform: scaleY(0.55);
            opacity: 0.55;
          }
          75% {
            transform: scaleY(0.85);
            opacity: 0.8;
          }
        }

        @keyframes skeletonStaggeredFadeOut {
          from {
            opacity: 1;
            transform: scaleY(1);
          }
          to {
            opacity: 0;
            transform: scaleY(0.2);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .waveBar {
            animation: none;
            opacity: 0.6;
            transform: scaleY(0.6);
          }

          .exitBar {
            animation: none;
            opacity: 0;
            transform: scaleY(0.2);
          }
        }
      `}</style>
    </>
  );
}
