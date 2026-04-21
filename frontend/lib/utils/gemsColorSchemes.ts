import type { GenericColumnColorScheme } from "@/components/common/GenericColumn";

/**
 * Paleta de cores unificada para categorias (Gems, Kanban, Insights).
 * Usa tokens do design system: chart-1..5, success, warning, info.
 */

export const gemsMetricColorSchemes: Record<
  "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr" | "cpmql",
  GenericColumnColorScheme
> = {
  hook: {
    headerBg: "bg-chart-1-10 border-chart-1-30",
    title: "",
    card: {
      border: "border-chart-1-30",
      bg: "bg-chart-1-5",
      text: "text-chart-1",
      accent: "border-chart-1",
      badge: "bg-chart-1 text-primary-foreground",
    },
  },
  website_ctr: {
    headerBg: "bg-chart-2-10 border-chart-2-30",
    title: "",
    card: {
      border: "border-chart-2-30",
      bg: "bg-chart-2-5",
      text: "text-chart-2",
      accent: "border-chart-2",
      badge: "bg-chart-2 text-primary-foreground",
    },
  },
  ctr: {
    headerBg: "bg-success-10 border-success-30",
    title: "",
    card: {
      border: "border-success-30",
      bg: "bg-success-10",
      text: "text-success",
      accent: "border-success",
      badge: "bg-success text-success-foreground",
    },
  },
  page_conv: {
    headerBg: "bg-warning-10 border-warning-30",
    title: "",
    card: {
      border: "border-warning-30",
      bg: "bg-warning-10",
      text: "text-warning",
      accent: "border-warning",
      badge: "bg-warning text-warning-foreground",
    },
  },
  hold_rate: {
    headerBg: "bg-chart-3-10 border-chart-3-30",
    title: "",
    card: {
      border: "border-chart-3-30",
      bg: "bg-chart-3-5",
      text: "text-chart-3",
      accent: "border-chart-3",
      badge: "bg-chart-3 text-primary-foreground",
    },
  },
  cpr: {
    headerBg: "bg-primary-10 border-primary-30",
    title: "",
    card: {
      border: "border-primary-30",
      bg: "bg-primary-10",
      text: "text-primary",
      accent: "border-primary",
      badge: "bg-primary text-primary-foreground",
    },
  },
  cpmql: {
    headerBg: "bg-chart-4-10 border-chart-4-30",
    title: "",
    card: {
      border: "border-chart-4-30",
      bg: "bg-chart-4-5",
      text: "text-chart-4",
      accent: "border-chart-4",
      badge: "bg-chart-4 text-primary-foreground",
    },
  },
};

export const gemsModalMetricColorSchemes: Record<
  "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate",
  GenericColumnColorScheme
> = {
  hook: gemsMetricColorSchemes.hook,
  website_ctr: gemsMetricColorSchemes.website_ctr,
  ctr: gemsMetricColorSchemes.ctr,
  page_conv: gemsMetricColorSchemes.page_conv,
  hold_rate: gemsMetricColorSchemes.hold_rate,
};

/** Paleta para categorias G.O.L.D. (golds, oportunidades, licoes, descartes, neutros) */
export const goldBucketColorSchemes: Record<
  "golds" | "oportunidades" | "licoes" | "descartes" | "neutros",
  GenericColumnColorScheme
> = {
  golds: {
    headerBg: "bg-warning-10 border-warning-30",
    title: "",
    card: {
      border: "border-warning-30",
      bg: "bg-warning-10",
      text: "text-warning",
      accent: "border-warning",
      badge: "bg-warning text-warning-foreground",
    },
  },
  oportunidades: gemsMetricColorSchemes.hook,
  licoes: gemsMetricColorSchemes.website_ctr,
  descartes: {
    headerBg: "bg-destructive-20 border-destructive-40",
    title: "",
    card: {
      border: "border-destructive-40",
      bg: "bg-destructive-20",
      text: "text-destructive",
      accent: "border-destructive",
      badge: "bg-destructive text-destructive-foreground",
    },
  },
  neutros: {
    headerBg: "bg-muted-20 border-muted-40",
    title: "",
    card: {
      border: "border-muted-40",
      bg: "bg-muted-20",
      text: "text-muted-foreground",
      accent: "border-muted-foreground",
      badge: "bg-muted text-muted-foreground",
    },
  },
};
