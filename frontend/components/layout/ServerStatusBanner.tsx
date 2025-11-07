"use client"

import { useServerHealth } from "@/lib/hooks/useServerHealth"
import { IconWifi, IconWifiOff, IconLoader2, IconCheck } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useEffect, useState, useRef } from "react"

/**
 * Banner de status do servidor que aparece acima do topbar
 * quando o servidor backend está offline.
 * 
 * Renderizado junto com o topheader de forma responsiva.
 */
export default function ServerStatusBanner() {
  const { status, isChecking, lastOnlineAt, hasCheckedOnce, refetch } = useServerHealth({
    checkInterval: 30000,
    enabled: true,
  })

  const [showOnlineFeedback, setShowOnlineFeedback] = useState(false)
  const previousStatusRef = useRef<typeof status>('checking')

  // Detectar quando volta de offline para online e mostrar feedback temporário
  useEffect(() => {
    const previousStatus = previousStatusRef.current
    const currentStatus = status

    // Se mudou de offline para online, mostrar feedback
    if (previousStatus === 'offline' && currentStatus === 'online' && hasCheckedOnce) {
      setShowOnlineFeedback(true)
      // Esconder após 2 segundos
      const timer = setTimeout(() => {
        setShowOnlineFeedback(false)
      }, 2000)
      
      // Atualizar referência
      previousStatusRef.current = currentStatus
      
      return () => clearTimeout(timer)
    }

    // Atualizar referência sempre
    previousStatusRef.current = currentStatus
  }, [status, hasCheckedOnce])

  // Mostrar feedback de reconexão (verde, temporário)
  if (showOnlineFeedback && status === 'online') {
    return (
      <div className="w-full bg-green-900/20 border-b border-green-800/50 py-2">
        <div className="hidden md:flex container mx-auto items-center justify-center px-8">
          <div className="flex items-center gap-2 text-green-400">
            <IconCheck className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Servidor reconectado!</span>
          </div>
        </div>
        <div className="md:hidden container mx-auto flex items-center justify-center px-4">
          <div className="flex items-center gap-2 text-green-400">
            <IconCheck className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Servidor reconectado!</span>
          </div>
        </div>
      </div>
    )
  }

  // Não renderizar nada se:
  // 1. Estiver online (sem feedback de reconexão)
  // 2. Estiver verificando pela primeira vez (evita flicker no carregamento inicial)
  if (status === 'online' || (status === 'checking' && !hasCheckedOnce)) {
    return null
  }

  // Se estiver verificando após já ter verificado antes, mostrar estado de loading
  if (status === 'checking' && isChecking && hasCheckedOnce) {
    return (
      <div className="w-full bg-yellow-900/20 border-b border-yellow-800/50 py-2">
        <div className="hidden md:flex container mx-auto items-center justify-between px-8">
          <div className="flex items-center gap-2 text-yellow-400">
            <IconLoader2 className="h-4 w-4 animate-spin shrink-0" />
            <span className="text-sm font-medium">Verificando conexão com o servidor...</span>
          </div>
        </div>
        <div className="md:hidden container mx-auto flex items-center justify-between px-4">
          <div className="flex items-center gap-2 text-yellow-400">
            <IconLoader2 className="h-4 w-4 animate-spin shrink-0" />
            <span className="text-sm font-medium">Verificando conexão com o servidor...</span>
          </div>
        </div>
      </div>
    )
  }

  // Servidor offline (só aparece quando confirmado)
  return (
    <div className="w-full bg-red-900/20 border-b border-red-800/50 py-2">
      {/* Desktop Layout */}
      <div className="hidden md:flex container mx-auto items-center justify-between px-8">
        <div className="flex items-center gap-2 text-red-400 min-w-0">
          <IconWifiOff className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium truncate">
            Servidor offline
            {lastOnlineAt && (
              <span className="text-red-500/70 ml-2 font-normal">
                (última conexão há {formatDistanceToNow(lastOnlineAt, { 
                  addSuffix: true, 
                  locale: ptBR 
                })})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isChecking}
            className="h-7 text-xs border-red-800/50 text-red-400 hover:bg-red-900/30"
          >
            {isChecking ? (
              <>
                <IconLoader2 className="h-3 w-3 mr-1 animate-spin" />
                Verificando...
              </>
            ) : (
              <>
                <IconWifi className="h-3 w-3 mr-1" />
                Tentar novamente
              </>
            )}
          </Button>
        </div>
      </div>
      {/* Mobile Layout */}
      <div className="md:hidden container mx-auto flex items-center justify-between flex-wrap gap-2 px-4">
        <div className="flex items-center gap-2 text-red-400 min-w-0">
          <IconWifiOff className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium truncate">
            Servidor offline
            {lastOnlineAt && (
              <span className="text-red-500/70 ml-2 font-normal">
                (última conexão há {formatDistanceToNow(lastOnlineAt, { 
                  addSuffix: true, 
                  locale: ptBR 
                })})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isChecking}
            className="h-7 text-xs border-red-800/50 text-red-400 hover:bg-red-900/30"
          >
            {isChecking ? (
              <>
                <IconLoader2 className="h-3 w-3 mr-1 animate-spin" />
                Verificando...
              </>
            ) : (
              <>
                <IconWifi className="h-3 w-3 mr-1" />
                Tentar novamente
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

