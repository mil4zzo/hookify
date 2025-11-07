/**
 * Formata uma string para titlecase (primeira letra de cada palavra maiúscula)
 * @param text Texto a ser formatado
 * @returns Texto formatado em titlecase, ou string vazia se o texto for inválido
 */
export function formatToTitleCase(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove espaços extras e divide em palavras
  const words = text.trim().split(/\s+/);
  
  // Formata cada palavra: primeira letra maiúscula, resto minúscula
  const formattedWords = words.map(word => {
    if (word.length === 0) return '';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return formattedWords.join(' ');
}

