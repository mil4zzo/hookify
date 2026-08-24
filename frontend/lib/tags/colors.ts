/**
 * Paleta de cores de tag.
 *
 * Usa os tokens `--chart-*` do design system, não famílias cruas do Tailwind: a
 * paleta de gráficos já é categórica (feita para distinguir N séries), já responde
 * a tema claro/escuro e já passa pelo checker. Uma paleta paralela de famílias
 * cruas do Tailwind seria uma segunda fonte de cor, invisível ao tema.
 *
 * São 5 cores de propósito — é o que a paleta categórica oferece, e é suficiente
 * para uma taxonomia plana. Ampliar exige tokens novos no tailwind.config e
 * registro em cn.ts, não classes cruas aqui.
 *
 * Espelha TAG_COLORS em backend/app/routes/tags.py, que valida a cor na escrita.
 * Mudar um lado exige mudar o outro, senão a cor volta do banco sem classe.
 *
 * As classes são literais: o scanner do Tailwind só enxerga strings completas no
 * fonte — montar `bg-chart-${n}-20` em runtime não gera CSS.
 */
export const TAG_COLORS = ["chart1", "chart2", "chart3", "chart4", "chart5"] as const

export type TagColor = (typeof TAG_COLORS)[number]

export const DEFAULT_TAG_COLOR: TagColor = "chart1"

/** Classes da chip (fundo + texto + borda). Alpha por hífen — é token semântico. */
const CHIP_CLASSES: Record<TagColor, string> = {
  chart1: "bg-chart-1-20 text-chart-1 border-chart-1-30",
  chart2: "bg-chart-2-20 text-chart-2 border-chart-2-30",
  chart3: "bg-chart-3-20 text-chart-3 border-chart-3-30",
  chart4: "bg-chart-4-20 text-chart-4 border-chart-4-30",
  chart5: "bg-chart-5-20 text-chart-5 border-chart-5-30",
}

/** Bolinha sólida usada no seletor de cor e ao lado do nome na lista. */
const DOT_CLASSES: Record<TagColor, string> = {
  chart1: "bg-chart-1",
  chart2: "bg-chart-2",
  chart3: "bg-chart-3",
  chart4: "bg-chart-4",
  chart5: "bg-chart-5",
}

/**
 * Cor desconhecida cai no default em vez de quebrar: uma linha gravada fora do
 * backend (ou de uma versão anterior da paleta) ainda renderiza.
 */
function normalize(color: string | null | undefined): TagColor {
  const value = (color || "").trim().toLowerCase()
  return (TAG_COLORS as readonly string[]).includes(value)
    ? (value as TagColor)
    : DEFAULT_TAG_COLOR
}

export function tagChipClasses(color: string | null | undefined): string {
  return CHIP_CLASSES[normalize(color)]
}

export function tagDotClasses(color: string | null | undefined): string {
  return DOT_CLASSES[normalize(color)]
}

/**
 * Cor da próxima tag, rodando a paleta pelo total já existente.
 *
 * Escolher cor na criação é uma decisão a mais num fluxo que precisa ser de um
 * clique — e o dropdown de referência (ActiveCampaign) não pede cor nenhuma.
 * Rotacionar mantém tags vizinhas distinguíveis sem perguntar nada.
 */
export function nextTagColor(existingCount: number): TagColor {
  const index = Number.isFinite(existingCount) && existingCount > 0 ? Math.floor(existingCount) : 0
  return TAG_COLORS[index % TAG_COLORS.length]
}
