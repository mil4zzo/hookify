"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { RetentionChartOverlay } from "@/components/charts/RetentionChartOverlay";
import { Skeleton } from "@/components/ui/skeleton";
import { VideoPlayer } from "@/components/common/VideoPlayer";

interface RetentionVideoPlayerProps {
  src: string;
  autoplay?: boolean;
  initialTime?: number | null;
  onTimeSet?: () => void;
  retentionCurve?: number[];
  showRetentionLoadingOverlay?: boolean;
  showRetentionYAxisLabels?: boolean;
}

export function RetentionVideoPlayer({
  src,
  autoplay = false,
  initialTime,
  onTimeSet,
  retentionCurve,
  showRetentionLoadingOverlay = false,
  showRetentionYAxisLabels = true,
}: RetentionVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (autoplay && videoRef.current) {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.log("Autoplay bloqueado:", error);
        });
      }
    }
  }, [autoplay, src]);

  useEffect(() => {
    if (initialTime != null && videoRef.current) {
      const video = videoRef.current;

      const handleLoadedMetadata = () => {
        if (video.duration >= initialTime) {
          video.currentTime = initialTime;
          onTimeSet?.();
        }
      };

      if (video.readyState >= 1) {
        handleLoadedMetadata();
      } else {
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        return () => {
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        };
      }
    }
  }, [initialTime, onTimeSet, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let rafId: number | null = null;

    const tick = () => {
      setCurrentTime(video.currentTime);
      rafId = requestAnimationFrame(tick);
    };

    const startRaf = () => {
      if (rafId == null) rafId = requestAnimationFrame(tick);
    };

    const stopRaf = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setCurrentTime(video.currentTime);
    };

    const handleTimeUpdate = () => {
      if (!video.paused) return;
      setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleDurationChange = () => {
      setDuration(video.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      startRaf();
    };

    const handlePause = () => {
      setIsPlaying(false);
      stopRaf();
    };

    const handleEnded = () => {
      setIsPlaying(false);
      stopRaf();
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);

    if (video.readyState >= 1) {
      setDuration(video.duration);
      setCurrentTime(video.currentTime);
    }

    setIsPlaying(!video.paused && !video.ended);
    if (!video.paused && !video.ended) startRaf();

    return () => {
      stopRaf();
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
    };
  }, [src]);

  const handleTimeSeek = (second: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = second;
      setCurrentTime(second);
    }
  };

  return (
    <div className="relative w-full h-full flex justify-center overflow-visible">
      <div className="relative w-full h-full overflow-visible">
        <VideoPlayer ref={videoRef} src={src} autoPlay={autoplay} className="absolute inset-0" />
        {showRetentionLoadingOverlay && (
          <div className="absolute inset-0 z-10 flex flex-col justify-between rounded-lg bg-black/24 p-4 pointer-events-none">
            <div className="self-start rounded-md bg-background-90 px-3 py-1.5 shadow-sm backdrop-blur-sm">
              <div className="text-[11px] font-medium text-foreground">Carregando retenção...</div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-24 w-full rounded-md bg-background-40" />
              <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-8 rounded-md bg-background-40" />
                <Skeleton className="h-8 rounded-md bg-background-40" />
                <Skeleton className="h-8 rounded-md bg-background-40" />
              </div>
            </div>
          </div>
        )}
        {retentionCurve && retentionCurve.length > 0 && (
          <RetentionChartOverlay
            videoPlayCurve={retentionCurve}
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            onTimeSeek={handleTimeSeek}
            showYAxisLabels={showRetentionYAxisLabels}
          />
        )}
      </div>
    </div>
  );
}

export function RetentionVideoPlayerSkeleton({ className = "" }: { className?: string }) {
  const axisTicks = [
    { label: "100%", value: 100 },
    { label: "80%", value: 80 },
    { label: "60%", value: 60 },
    { label: "40%", value: 40 },
    { label: "20%", value: 20 },
    { label: "0%", value: 0 },
  ];

  return (
    <div className={`relative w-full h-full overflow-visible ${className}`.trim()}>
      <div className="absolute left-[-2rem] top-0 bottom-[48px] pr-2 md:bottom-[80px] z-10 w-6 pointer-events-none">
        {axisTicks.map(({ label, value }) => (
          <span
            key={label}
            className="absolute right-0 block text-right text-[10px] font-normal leading-none"
            style={{
              top: `${100 - value}%`,
              transform: "translateY(0.33em) translateX(0.1rem)",
              color: "oklch(0.705 0.015 286.067)",
            }}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="relative h-full w-full overflow-hidden rounded-lg">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center justify-center rounded-full bg-muted p-4">
          <Play className="h-9 w-9 fill-border text-border" strokeWidth={1.4} />
        </div>
      </div>
    </div>
  );
}
