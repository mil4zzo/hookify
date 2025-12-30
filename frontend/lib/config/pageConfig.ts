import { 
  IconCardsFilled, 
  IconFlask, 
  IconStack2, 
  IconTrophyFilled,
  IconBulbFilled,
  IconPalette,
  IconDiamond
} from "@tabler/icons-react";
import { ComponentType } from "react";

export interface PageConfig {
  path: string;
  title: string;
  label: string; // Para usar no Sidebar
  icon: ComponentType<{ className?: string }>;
  description?: string;
  isDevelopment?: boolean; // Para separar páginas de desenvolvimento
  showInMenu?: boolean; // Para controlar se aparece no menu
}

export const pageConfigs: PageConfig[] = [
  {
    path: "/packs",
    title: "Packs",
    label: "Packs",
    icon: IconCardsFilled,
    description: "Carregue seus packs de anúncios e combine-os para análise",
    showInMenu: true,
  },
  {
    path: "/manager",
    title: "Manager",
    label: "Manager",
    icon: IconTrophyFilled,
    description: "Gerencie e visualize performance dos seus anúncios",
    showInMenu: true,
  },
  {
    path: "/insights",
    title: "Insights",
    label: "Insights",
    icon: IconBulbFilled,
    description: "Análises e insights sobre seus anúncios",
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
    path: "/cores",
    title: "Cores",
    label: "Cores",
    icon: IconPalette,
    isDevelopment: true,
    showInMenu: true,
  },
  {
    path: "/components-showcase",
    title: "Components Showcase",
    label: "Components",
    icon: IconStack2,
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

// Helper functions
export function getPageConfig(path: string): PageConfig | undefined {
  return pageConfigs.find((config) => config.path === path);
}

export function getMenuItems(): PageConfig[] {
  return pageConfigs.filter((config) => config.showInMenu && !config.isDevelopment);
}

export function getDevelopmentItems(): PageConfig[] {
  return pageConfigs.filter((config) => config.showInMenu && config.isDevelopment);
}

// Para usar no Topbar - compatível com o formato atual
export const pageTitles: Record<string, { title: string; icon?: ComponentType<{ className?: string }> }> = 
  pageConfigs.reduce((acc, config) => {
    acc[config.path] = { title: config.title, icon: config.icon };
    return acc;
  }, {} as Record<string, { title: string; icon?: ComponentType<{ className?: string }> }>);

