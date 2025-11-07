import { usePathname } from "next/navigation";
import { getPageConfig, PageConfig } from "@/lib/config/pageConfig";

export function usePageConfig(): PageConfig | undefined {
  const pathname = usePathname();
  return getPageConfig(pathname);
}

