"use client"
import { Loader2, TriangleAlert, FolderOpen } from 'lucide-react'

export function LoadingState({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-danger">
      <TriangleAlert className="h-5 w-5" />
      <span className="text-text">{message}</span>
      {action}
    </div>
  )
}

export function EmptyState({ message = 'Sem dados para exibir' }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 text-muted">
      <FolderOpen className="h-5 w-5" />
      <span>{message}</span>
    </div>
  )
}


