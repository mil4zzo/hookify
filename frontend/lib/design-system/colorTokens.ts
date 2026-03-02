/**
 * Definições de tokens de cor do design system.
 * Usado pela página /design-system para exibir a paleta.
 * Categorias alinhadas a frontend/docs/DESIGN_SYSTEM.md.
 */
export interface ColorTokenDef {
  name: string;
  value: string;
  category: "Base" | "Feedback" | "Componentes" | "Superfícies" | "Brand" | "Gráficos";
}

export const colorTokenDefinitions: ColorTokenDef[] = [
  // === BASE ===
  { name: "background", value: "var(--background)", category: "Base" },
  { name: "foreground", value: "var(--foreground)", category: "Base" },
  { name: "background-50", value: "color-mix(in oklab, var(--background) 50%, transparent)", category: "Base" },
  { name: "background-90", value: "color-mix(in oklab, var(--background) 90%, transparent)", category: "Base" },

  // === FEEDBACK ===
  { name: "destructive", value: "var(--destructive)", category: "Feedback" },
  { name: "destructive-foreground", value: "var(--destructive-foreground)", category: "Feedback" },
  { name: "destructive-20", value: "color-mix(in oklab, var(--destructive) 20%, transparent)", category: "Feedback" },
  { name: "destructive-90", value: "color-mix(in oklab, var(--destructive) 90%, transparent)", category: "Feedback" },
  { name: "success", value: "var(--success)", category: "Feedback" },
  { name: "success-foreground", value: "var(--success-foreground)", category: "Feedback" },
  { name: "success-20", value: "color-mix(in oklab, var(--success) 20%, transparent)", category: "Feedback" },
  { name: "warning", value: "var(--warning)", category: "Feedback" },
  { name: "warning-foreground", value: "var(--warning-foreground)", category: "Feedback" },
  { name: "warning-20", value: "color-mix(in oklab, var(--warning) 20%, transparent)", category: "Feedback" },
  { name: "attention", value: "var(--attention)", category: "Feedback" },
  { name: "attention-foreground", value: "var(--attention-foreground)", category: "Feedback" },
  { name: "attention-20", value: "color-mix(in oklab, var(--attention) 20%, transparent)", category: "Feedback" },

  // === COMPONENTES ===
  { name: "card", value: "var(--card)", category: "Componentes" },
  { name: "card-foreground", value: "var(--card-foreground)", category: "Componentes" },
  { name: "popover", value: "var(--popover)", category: "Componentes" },
  { name: "popover-foreground", value: "var(--popover-foreground)", category: "Componentes" },
  { name: "border", value: "var(--border)", category: "Componentes" },
  { name: "input", value: "var(--input)", category: "Componentes" },
  { name: "input-foreground", value: "var(--input-foreground)", category: "Componentes" },
  { name: "overlay", value: "var(--overlay)", category: "Componentes" },
  { name: "ring", value: "var(--ring)", category: "Componentes" },

  // === SUPERFÍCIES ===
  { name: "surface", value: "var(--surface)", category: "Superfícies" },
  { name: "surface-2", value: "var(--surface-2)", category: "Superfícies" },
  { name: "surface3", value: "var(--surface-3)", category: "Superfícies" },
  { name: "muted", value: "var(--muted)", category: "Superfícies" },
  { name: "muted-foreground", value: "var(--muted-foreground)", category: "Superfícies" },
  { name: "muted-20", value: "color-mix(in oklab, var(--muted) 20%, transparent)", category: "Superfícies" },
  { name: "accent", value: "var(--accent)", category: "Superfícies" },
  { name: "accent-foreground", value: "var(--accent-foreground)", category: "Superfícies" },
  { name: "secondary", value: "var(--secondary)", category: "Superfícies" },
  { name: "secondary-foreground", value: "var(--secondary-foreground)", category: "Superfícies" },

  // === BRAND ===
  { name: "primary", value: "var(--primary)", category: "Brand" },
  { name: "primary-foreground", value: "var(--primary-foreground)", category: "Brand" },
  { name: "primary-10", value: "color-mix(in oklab, var(--primary) 10%, transparent)", category: "Brand" },
  { name: "primary-20", value: "color-mix(in oklab, var(--primary) 20%, transparent)", category: "Brand" },
  { name: "primary-90", value: "color-mix(in oklab, var(--primary) 90%, transparent)", category: "Brand" },

  // === GRÁFICOS ===
  { name: "chart-1", value: "var(--chart-1)", category: "Gráficos" },
  { name: "chart-2", value: "var(--chart-2)", category: "Gráficos" },
  { name: "chart-3", value: "var(--chart-3)", category: "Gráficos" },
  { name: "chart-4", value: "var(--chart-4)", category: "Gráficos" },
  { name: "chart-5", value: "var(--chart-5)", category: "Gráficos" },
];

export const colorCategoriesOrder: ColorTokenDef["category"][] = [
  "Base",
  "Feedback",
  "Componentes",
  "Superfícies",
  "Brand",
  "Gráficos",
];
