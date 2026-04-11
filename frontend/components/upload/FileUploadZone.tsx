"use client"

import { useRef } from "react"
import { IconPhoto, IconUpload, IconVideo, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

interface FileUploadZoneProps {
  files: File[]
  onFilesChange: (files: File[]) => void
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "video/mp4", "video/quicktime"]

export default function FileUploadZone({ files, onFilesChange }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  function appendFiles(nextFiles: FileList | null) {
    if (!nextFiles) return
    const valid = Array.from(nextFiles).filter((file) => ACCEPTED_TYPES.includes(file.type))
    onFilesChange([...files, ...valid])
  }

  return (
    <div className="space-y-4">
      <Card
        className="flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 border-dashed p-6 text-center"
        onClick={() => inputRef.current?.click()}
      >
        <div className="rounded-full bg-primary/10 p-4 text-primary">
          <IconUpload className="h-8 w-8" />
        </div>
        <div>
          <div className="font-medium">Arraste arquivos aqui ou clique para selecionar</div>
          <div className="text-sm text-muted-foreground">JPG, PNG, MP4 ou MOV</div>
        </div>
        <Button type="button" variant="outline">Selecionar arquivos</Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept=".jpg,.jpeg,.png,.mp4,.mov"
          onChange={(event) => appendFiles(event.target.files)}
        />
      </Card>

      <div className="space-y-2">
        {files.map((file, index) => {
          const isVideo = file.type.startsWith("video/")
          return (
            <Card key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                {isVideo ? <IconVideo className="h-5 w-5 text-muted-foreground" /> : <IconPhoto className="h-5 w-5 text-muted-foreground" />}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onFilesChange(files.filter((_, currentIndex) => currentIndex !== index))}
              >
                <IconX className="h-4 w-4" />
              </Button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
