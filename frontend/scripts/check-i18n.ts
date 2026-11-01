import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, sep } from "path";

/**
 * Idioma: formato de número, data e lista sai de `getAppLocale()` (lib/i18n/locale.ts),
 * nunca de um código de idioma escrito à mão na tela. Um "pt-BR" solto na tela faz o
 * app em inglês mostrar data e milhar do jeito brasileiro — e ninguém percebe até o
 * primeiro usuário de fora.
 *
 * Fora da regra de propósito, com motivo (lista abaixo): quem DEFINE ou ESCOLHE o
 * idioma, chave de comparação que tem de ser igual para todos, página pública do link
 * (o idioma é de quem lê) e campo que interpreta o que o usuário digita. Exceção
 * pontual: `// i18n-exception: motivo` na linha acima.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib"];
const EXTENSIONS = new Set([".ts", ".tsx"]);
const LOCALE_LITERAL = /(["'`])(?:pt-BR|en-US|es-ES)\1/;

type AllowEntry = { pattern: RegExp; reason: string };

const ALLOWLIST: AllowEntry[] = [
  { pattern: /^lib\/i18n\//, reason: "dono do locale" },
  { pattern: /^(lib\/hooks\/useLanguage|lib\/store\/settings|lib\/store\/userPreferences|lib\/types\/index)\.ts$/, reason: "define o idioma e o padrão" },
  { pattern: /^(app\/onboarding\/steps\/InitialSettingsStep|components\/layout\/Topbar)\.tsx$/, reason: "seletor de idioma" },
  { pattern: /^app\/(layout|pv\/page|docs\/page)\.tsx$/, reason: "idioma do documento/SEO (precisa ser conhecido no servidor)" },
  { pattern: /^(app\/s\/\[token\]\/page\.tsx|components\/share\/StoriesViewer\.tsx|lib\/share\/metricsDisplay\.ts)$/, reason: "página pública do link: idioma de quem lê, decisão própria" },
  { pattern: /^(components\/packs\/(FolderNameDialog|MoveToFolderDialog)\.tsx|app\/packs\/page\.tsx)$/, reason: "comparação de nome (duplicado/busca) tem de ser igual para todos" },
  { pattern: /^lib\/utils\/(leadEconomics|leadEconomicsDraft|leadEconomicsCsv)\.ts$|^components\/packs\/LeadEconomicsEditor\.tsx$/, reason: "campo que interpreta o que o usuário digita (vírgula decimal): migra junto com a leitura" },
  { pattern: /^lib\/(explorer\/(viewModels|flowSections)|hooks\/useFolders|manager\/provenance|rules\/dimensionOptions|utils\/folderTree|utils\/packSort)\.ts$/, reason: "ordenação (diferença mínima entre os idiomas) e tela legada" },
  { pattern: /^components\/launch\//, reason: "tela nova em andamento em outra frente: migra quando fechar" },
];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(full))) out.push(full);
  }
}

const files: string[] = [];
for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);

const findings: string[] = [];
for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (ALLOWLIST.some((entry) => entry.pattern.test(rel))) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((text, index) => {
    if (!LOCALE_LITERAL.test(text)) return;
    if (index > 0 && lines[index - 1].includes("i18n-exception:")) return;
    findings.push(`${rel}:${index + 1}: ${text.trim().slice(0, 120)}`);
  });
}

if (findings.length > 0) {
  console.error("Idioma escrito à mão. Use getAppLocale() / formatLocaleNumber / formatLocaleDate de @/lib/i18n/locale:\n");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log("i18n check passed. Nenhum idioma escrito à mão fora da lista aprovada.");
