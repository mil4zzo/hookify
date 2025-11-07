"use client";

import { Modal } from "@/components/common/Modal";
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
    <Modal isOpen={open} onClose={() => onOpenChange(false)} size="xl" className="max-w-4xl" padding="md">
      <div className="space-y-1.5 mb-6">
        <h2 className="text-lg font-semibold leading-none tracking-tight">{title || "Preview do Vídeo"}</h2>
        <p className="text-sm text-muted-foreground">Visualização do criativo do anúncio com fonte direta do Meta API</p>
      </div>

      <div className="aspect-video w-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
        {isLoading && <div className="text-sm text-muted-foreground p-6">Carregando vídeo...</div>}
        {error && <div className="text-sm text-red-500 p-6">Falha ao carregar o vídeo</div>}
        {!isLoading && !error && sourceUrl && <video src={sourceUrl} controls className="w-full h-full" />}
      </div>
    </Modal>
  );
}
