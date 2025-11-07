import { 
  IconAdFilled, 
  IconLayoutDashboardFilled,
  IconFlask, 
  IconTable, 
  IconStack2, 
  IconTrophyFilled,
  IconBulb
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
    path: "/ads-loader",
    title: "ADs Loader",
    label: "ADs Loader",
    icon: IconAdFilled,
    description: "Carregue seus packs de anúncios e combine-os para análise",
    showInMenu: true,
  },
  {
    path: "/dashboard",
    title: "Dashboard",
    label: "Dashboard",
    icon: IconLayoutDashboardFilled,
    description: "Visualize métricas e estatísticas dos seus anúncios",
    showInMenu: true,
  },
  {
    path: "/rankings",
    title: "Rankings",
    label: "Rankings",
    icon: IconTrophyFilled,
    description: "Visualize rankings de performance dos seus anúncios",
    showInMenu: true,
  },
  {
    path: "/insights",
    title: "Insights",
    label: "Insights",
    icon: IconBulb,
    description: "Análises e insights sobre seus anúncios",
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
  {
    path: "/table-demo",
    title: "Table Demo",
    label: "Table Demo",
    icon: IconTable,
    isDevelopment: true,
    showInMenu: true,
  },
  {
    path: "/components-showcase",
    title: "Components Showcase",
    label: "Components Showcase",
    icon: IconStack2,
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

