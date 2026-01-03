"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

interface ThumbnailImageProps {
  src: string | null;
  alt?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  fallbackClassName?: string;
}

const sizeClasses = {
  sm: "w-10 h-10",
  md: "w-14 h-14",
  lg: "w-20 h-20",
};

// Cache global para rastrear imagens já carregadas
const imageCache = new Set<string>();

/**
 * Verifica se uma imagem já está carregada no cache do navegador de forma síncrona
 * Retorna true se está no nosso cache, false caso contrário
 */
function isImageInCache(src: string): boolean {
  return imageCache.has(src);
}

/**
 * Verifica se uma imagem já está carregada no cache do navegador de forma assíncrona
 */
function checkImageCache(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Se já está no nosso cache, retornar imediatamente
    if (imageCache.has(src)) {
      resolve(true);
      return;
    }

    // Tentar verificar o cache do navegador criando uma imagem
    const img = new Image();

    // Definir src primeiro
    img.src = src;

    // Verificar imediatamente após definir src (pode estar em cache do navegador)
    if (img.complete && img.naturalHeight !== 0) {
      imageCache.add(src);
      resolve(true);
      return;
    }

    // Se não está completa, aguardar eventos
    let resolved = false;

    const resolveOnce = (value: boolean) => {
      if (!resolved) {
        resolved = true;
        if (value) {
          imageCache.add(src);
        }
        resolve(value);
      }
    };

    img.onload = () => resolveOnce(true);
    img.onerror = () => resolveOnce(false);

    // Timeout curto para não bloquear - se não carregar em 50ms, assumir que não está em cache
    const timeout = setTimeout(() => {
      // Se ainda não completou, provavelmente não está em cache
      if (!img.complete) {
        resolveOnce(false);
      }
    }, 50);

    // Verificar novamente após um microtask (pode ter carregado do cache)
    Promise.resolve().then(() => {
      if (img.complete && img.naturalHeight !== 0 && !resolved) {
        clearTimeout(timeout);
        resolveOnce(true);
      }
    });
  });
}

/**
 * Componente para renderizar thumbnails com skeleton durante carregamento.
 *
 * Mostra um skeleton enquanto a imagem está carregando,
 * e faz uma transição suave quando a imagem estiver pronta.
 *
 * @example
 * <ThumbnailImage src={thumbnailUrl} alt="Ad thumbnail" size="md" />
 */
export function ThumbnailImage({ src, alt = "thumbnail", className, size = "md", fallbackClassName }: ThumbnailImageProps) {
  const sizeClass = sizeClasses[size];

  // Verificar cache síncronamente ANTES de definir o estado inicial
  const initialIsCached = useMemo(() => {
    return src ? isImageInCache(src) : false;
  }, [src]);

  // Inicializar estados baseado no cache
  const [isLoading, setIsLoading] = useState(() => {
    // Se não tem src, não está carregando
    if (!src) return false;
    // Se está em cache, não está carregando
    return !initialIsCached;
  });
  const [hasError, setHasError] = useState(false);
  const [isCached, setIsCached] = useState(initialIsCached);
  const imgRef = useRef<HTMLImageElement>(null);

  // Verificar cache quando src mudar - executar imediatamente
  useEffect(() => {
    if (!src) {
      setIsLoading(false);
      setIsCached(false);
      setHasError(false);
      return;
    }

    // Verificar cache síncrono primeiro - atualizar estados imediatamente
    const cachedSync = isImageInCache(src);
    if (cachedSync) {
      // Atualizar estados de forma síncrona para evitar qualquer piscar
      setIsCached(true);
      setIsLoading(false);
      return;
    }

    // Se não está no cache síncrono, verificar assincronamente
    // Mas começar assumindo que está carregando
    setIsLoading(true);
    setIsCached(false);

    // Verificar cache assíncrono
    checkImageCache(src).then((cached) => {
      setIsCached(cached);
      if (cached) {
        setIsLoading(false);
      }
      setHasError(false);
    });
  }, [src]);

  // Verificar se a imagem já está carregada quando o elemento for montado
  // Usar requestAnimationFrame para verificar imediatamente após renderização
  useEffect(() => {
    if (!src || !imgRef.current) return;

    // Verificar imediatamente no próximo frame
    const rafId = requestAnimationFrame(() => {
      if (!imgRef.current) return;
      const img = imgRef.current;
      // Se a imagem já está completa, atualizar estados imediatamente
      if (img.complete && img.naturalHeight !== 0) {
        if (src) imageCache.add(src);
        setIsLoading(false);
        setIsCached(true);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [src]);

  // Se não há src, mostrar fallback
  if (!src) {
    return <div className={cn(sizeClass, "bg-border rounded flex-shrink-0", fallbackClassName)} />;
  }

  // Se houve erro ao carregar, mostrar fallback
  if (hasError) {
    return <div className={cn(sizeClass, "bg-border rounded flex-shrink-0", fallbackClassName)} />;
  }

  // Se está em cache, renderizar sem skeleton e sem opacity-0
  if (isCached) {
    return (
      <div className={cn(sizeClass, "relative flex-shrink-0", className)}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading="eager"
          className={cn(sizeClass, "object-cover rounded opacity-100")}
          onLoad={() => {
            if (src) imageCache.add(src);
          }}
          onError={() => {
            setHasError(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className={cn(sizeClass, "relative flex-shrink-0", className)}>
      {/* Só mostrar skeleton se estiver carregando */}
      {isLoading && <Skeleton className={cn(sizeClass, "absolute inset-0 rounded")} />}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        className={cn(sizeClass, "object-cover rounded", isLoading ? "opacity-0" : "opacity-100 transition-opacity duration-200")}
        onLoad={() => {
          if (src) imageCache.add(src);
          setIsLoading(false);
          setIsCached(true);
        }}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
      />
    </div>
  );
}
