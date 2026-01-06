/**
 * Formata o tempo relativo desde uma data até agora com diferentes níveis de detalhe.
 * 
 * @param dateTimeString - Data/hora no formato ISO string (ex: "2024-01-15T10:30:00Z")
 * @returns String formatada com tempo relativo ou absoluto
 * 
 * @example
 * formatRelativeTime("2024-01-15T10:30:00Z")
 * // Retorna: "Atualizado agora" (< 1 minuto)
 * // Retorna: "Atualizado há 15 mins" (< 1 hora)
 * // Retorna: "Atualizado há 2h e 30 mins" (>= 1 hora e < 48 horas)
 * // Retorna: "Atualizado às 14:30 - 15/01/2024" (>= 48 horas)
 */
export function formatRelativeTime(dateTimeString: string): string {
  if (!dateTimeString) return "Nunca atualizado";
  
  try {
    const date = new Date(dateTimeString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    // Se a data é no futuro (erro de timezone ou clock), mostrar formato absoluto
    if (diffMs < 0) {
      return formatAbsoluteDateTime(date);
    }

    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Caso 1: < 1 minuto
    if (diffMinutes < 1) {
      return "Atualizado agora";
    }
    // Caso 2: < 1 hora
    else if (diffMinutes < 60) {
      return `Atualizado há ${diffMinutes} min${diffMinutes > 1 ? "s" : ""}`;
    }
    // Caso 3: >= 1 hora e < 48 horas
    else if (diffHours < 48) {
      const remainingMinutes = diffMinutes % 60;
      if (remainingMinutes === 0) {
        return `Atualizado há ${diffHours}h`;
      } else {
        return `Atualizado há ${diffHours}h e ${remainingMinutes} min${remainingMinutes > 1 ? "s" : ""}`;
      }
    }
    // Caso 4: >= 48 horas - formato absoluto
    else {
      return formatAbsoluteDateTime(date);
    }
  } catch (error) {
    return "Data inválida";
  }
}

/**
 * Formata data/hora para formato absoluto "Atualizado às HH:mm - DD/MM/YYYY"
 */
function formatAbsoluteDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `Atualizado às ${hours}:${minutes} - ${day}/${month}/${year}`;
}





























