"use client";

import { forwardRef } from "react";

interface VideoPlayerProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
}

export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  ({ src, className = "", autoPlay = false }, ref) => (
    <div className={`bg-black rounded-lg overflow-hidden ${className}`}>
      <video
        ref={ref}
        src={src}
        controls
        playsInline
        autoPlay={autoPlay}
        className="w-full h-full object-contain"
      />
    </div>
  )
);
VideoPlayer.displayName = "VideoPlayer";
