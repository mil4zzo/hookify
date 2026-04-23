import {
  IconBook2,
  IconCardsFilled,
  IconCompass,
  IconDiamond,
  IconFlask,
  IconGauge,
  IconPalette,
  IconSitemapFilled,
  IconSunFilled,
  IconUpload,
} from "@tabler/icons-react";
import { ComponentType } from "react";

export interface PageConfig {
  path: string;
  title: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  isDevelopment?: boolean;
  showInMenu?: boolean;
}

export const pageConfigs: PageConfig[] = [
  {
    path: "/packs",
    title: "Packs",
    label: "Packs",
    icon: IconCardsFilled,
    description: "Carregue seus packs de anuncios e combine-os para analise",
    showInMenu: true,
  },
  {
    path: "/manager",
    title: "Manager",
    label: "Manager",
    icon: IconSitemapFilled,
    description: "Gerencie e visualize performance dos seus anuncios",
    showInMenu: true,
  },
  {
    path: "/insights",
    title: "Insights",
    label: "Insights",
    icon: IconSunFilled,
    description: "Analises e insights sobre seus anuncios",
    showInMenu: true,
  },
  {
    path: "/explorer",
    title: "Explorer",
    label: "Explorer",
    icon: IconCompass,
    description: "Analise profunda de criativos e seus gargalos",
    showInMenu: true,
  },
  {
    path: "/gold",
    title: "G.O.L.D.",
    label: "G.O.L.D.",
    icon: IconDiamond,
    description: "G.O.L.D.",
    showInMenu: true,
  },
  {
    path: "/upload",
    title: "Upload",
    label: "Upload",
    icon: IconUpload,
    description: "Crie anuncios em massa a partir de um modelo",
    showInMenu: true,
  },
  {
    path: "/meta-usage",
    title: "Meta Usage",
    label: "Meta Usage",
    icon: IconGauge,
    description: "Monitore o consumo da Meta Graph API",
    showInMenu: true,
  },
  {
    path: "/docs",
    title: "Documentacao",
    label: "Docs",
    icon: IconBook2,
    description: "Guia de uso da plataforma",
    showInMenu: false,
  },
  {
    path: "/design-system",
    title: "Design System",
    label: "Design System",
    icon: IconPalette,
    isDevelopment: true,
    showInMenu: true,
  },
  {
    path: "/api-test",
    title: "API Test",
    label: "API Test",
    icon: IconFlask,
    isDevelopment: true,
    showInMenu: true,
  },
];

export function getPageConfig(path: string): PageConfig | undefined {
  return pageConfigs.find((config) => config.path === path);
}

export function getMenuItems(): PageConfig[] {
  return pageConfigs.filter((config) => config.showInMenu && !config.isDevelopment);
}

export function getDevelopmentItems(): PageConfig[] {
  return pageConfigs.filter((config) => config.showInMenu && config.isDevelopment);
}

export const pageTitles: Record<
  string,
  { title: string; icon?: ComponentType<{ className?: string }> }
> = pageConfigs.reduce((acc, config) => {
  acc[config.path] = { title: config.title, icon: config.icon };
  return acc;
}, {} as Record<string, { title: string; icon?: ComponentType<{ className?: string }> }>);
