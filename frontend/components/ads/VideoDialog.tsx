"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useVideoSource } from "@/lib/api/hooks";

interface VideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId?: string;
  actorId?: string;
  title?: string;
}

export function VideoDialog({ open, onOpenChange, videoId, actorId, title }: VideoDialogProps) {
  const enabled = Boolean(open && videoId && actorId);
  const { data, isLoading, error } = useVideoSource({ video_id: videoId || "", actor_id: actorId || "" }, enabled);

  const sourceUrl = (data as any)?.source_url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title || "Preview do Vídeo"}</DialogTitle>
          <DialogDescription>Visualização do criativo do anúncio com fonte direta do Meta API</DialogDescription>
        </DialogHeader>

        <div className="aspect-video w-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
          {isLoading && <div className="text-sm text-muted p-6">Carregando vídeo...</div>}
          {error && <div className="text-sm text-red-500 p-6">Falha ao carregar o vídeo</div>}
          {!isLoading && !error && sourceUrl && <video src={sourceUrl} controls className="w-full h-full" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
