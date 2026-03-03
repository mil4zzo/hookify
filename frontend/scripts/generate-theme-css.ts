/**
 * Gera app/theme-generated.css a partir de lib/design-system/themeDefinitions.ts.
 * Executar com: npm run generate:themes
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { lightTheme, darkTheme, THEME_VAR_NAMES } from "../lib/design-system/themeDefinitions";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "app", "theme-generated.css");

function blockCss(selector: string, vars: Record<string, string>): string {
  const lines = THEME_VAR_NAMES.map((name) => {
    const value = vars[name];
    if (value === undefined) return null;
    return `  --${name}: ${value};`;
  }).filter(Boolean);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

const header = `/* Generated from lib/design-system/themeDefinitions.ts - do not edit by hand. Run npm run generate:themes to regenerate. */\n\n`;
const rootBlock = blockCss(":root", lightTheme);
const darkBlock = blockCss(':root[data-theme="dark"]', darkTheme);
const css = header + rootBlock + "\n" + darkBlock;

writeFileSync(outPath, css, "utf-8");
console.log("Written", outPath);
