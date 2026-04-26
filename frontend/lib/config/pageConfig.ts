import {
  IconBook2,
  IconCardsFilled,
  IconCompass,
  IconDiamond,
  IconFlask,
  IconGauge,
  IconPalette,
  IconShieldLock,
  IconSitemapFilled,
  IconSunFilled,
  IconUpload,
} from "@tabler/icons-react";
import { ComponentType } from "react";
import { type Tier, canAccess } from "@/lib/config/tierConfig";

export interface PageConfig {
  path: string;
  title: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  isDevelopment?: boolean;
  showInMenu?: boolean;
  minimumTier?: Tier;
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
    minimumTier: "insider",
  },
  {
    path: "/gold",
    title: "G.O.L.D.",
    label: "G.O.L.D.",
    icon: IconDiamond,
    description: "G.O.L.D.",
    showInMenu: true,
    minimumTier: "insider",
  },
  {
    path: "/upload",
    title: "Upload",
    label: "Upload",
    icon: IconUpload,
    description: "Crie anuncios em massa a partir de um modelo",
    showInMenu: true,
    minimumTier: "insider",
  },
  {
    path: "/meta-usage",
    title: "Meta Usage",
    label: "Meta Usage",
    icon: IconGauge,
    description: "Monitore o consumo da Meta Graph API",
    showInMenu: true,
    minimumTier: "insider",
  },
  {
    path: "/admin",
    title: "Admin",
    label: "Admin",
    icon: IconShieldLock,
    description: "Gerenciamento de usuários e tiers",
    showInMenu: true,
    minimumTier: "admin",
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

export function getMenuItems(userTier: Tier = "standard"): PageConfig[] {
  return pageConfigs.filter(
    (config) =>
      config.showInMenu &&
      !config.isDevelopment &&
      canAccess(userTier, config.minimumTier ?? "standard")
  );
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
