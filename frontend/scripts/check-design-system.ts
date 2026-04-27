import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, sep } from "path";

type RegexRule = {
  id: string;
  description: string;
  pattern: RegExp;
};

type Finding = {
  file: string;
  line: number;
  ruleId: string;
  description: string;
  text: string;
};

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "lib"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

const REGEX_RULES: RegexRule[] = [
  {
    id: "hardcoded-tailwind-color",
    description: "Use semantic design tokens instead of raw Tailwind color families.",
    pattern: /\b(?:bg|text|border|from|via|to|ring|shadow)-(?:red|yellow|gray|zinc|slate|stone|neutral|white|black|emerald|blue|purple|pink|amber|orange)-[A-Za-z0-9/.[\]-]+/,
  },
  {
    id: "large-radius",
    description: "Use rounded-sm, rounded-md, or rounded-lg unless this is an approved exception.",
    pattern: /\brounded-(?:xl|2xl|3xl)|\brounded-\[[^\]]+\]/,
  },
  {
    id: "raw-color",
    description: "Use theme tokens instead of raw hex/rgb/rgba values.",
    pattern: /#[0-9a-fA-F]{3,8}|\brgba?\(/,
  },
  {
    id: "emoji-icon",
    description: "Use an icon component or tokenized visual mark instead of emoji glyphs.",
    pattern: /[\u{1F300}-\u{1FAFF}]|Ã°Å¸/u,
  },
];

const GLOBAL_ALLOWLIST: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^components\/icons\//, reason: "brand icons keep official colors" },
  { pattern: /^components\/upload\/CreativePreview\.tsx$/, reason: "platform previews simulate ad surfaces" },
  { pattern: /^lib\/utils\/topBadgeStyles\.ts$/, reason: "centralized gold/silver/bronze badge recipes" },
  { pattern: /^components\/common\/TopBadge\.tsx$/, reason: "centralized gold/silver/bronze badge rendering" },
  { pattern: /^components\/common\/Modal\.tsx$/, reason: "runtime overlay opacity escape hatch" },
  { pattern: /^components\/common\/AppDialog\.tsx$/, reason: "runtime overlay opacity escape hatch" },
  { pattern: /^components\/charts\//, reason: "chart components compare computed runtime colors" },
  { pattern: /^app\/pv\/opengraph-image\.tsx$/, reason: "generated image fallback styling" },
  { pattern: /^app\/global-error\.tsx$/, reason: "framework-level fallback page before theme hydration" },
  { pattern: /^app\/design-system\/page\.tsx$/, reason: "design-system swatch demo needs raw preview paint" },
];

const DIRECT_PRIMITIVE_ALLOWLIST: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^components\/ui\//, reason: "low-level shadcn/Radix primitives" },
  { pattern: /^components\/common\/(?:Modal|AppDialog|StandardCard|ToggleSwitch|ConfirmDialog|AutoRefreshConfirmModal|BaseKanbanWidget|StatCard)\.tsx$/, reason: "shared component definitions and legacy wrappers" },
  { pattern: /^components\/ads\//, reason: "legacy detail/import dialogs are not part of this phase" },
  { pattern: /^components\/upload\//, reason: "upload internals keep platform/media exceptions during this phase" },
  { pattern: /^components\/charts\//, reason: "compact chart controls may use raw primitives" },
  { pattern: /^components\/layout\/Topbar\.tsx$/, reason: "settings dialog is a legacy shell" },
  { pattern: /^app\/\(auth\)\//, reason: "auth pages are outside authenticated app shell recipes" },
  { pattern: /^app\/onboarding\/steps\//, reason: "onboarding cards migrate with the form-step pass" },
  { pattern: /^app\/(?:api-test|ui-demo|design-system|pv)\//, reason: "dev/demo/public surfaces" },
  { pattern: /^app\/insights\/page\.tsx$/, reason: "legacy ad details modal remains until dialog migration phase" },
  { pattern: /^app\/packs\/page\.tsx$/, reason: "legacy pack modals stay until dialog migration phase" },
  { pattern: /^components\/common\/PackFilter\.tsx$/, reason: "legacy compact popover switch wrapper" },
  { pattern: /^components\/insights\/KanbanColumn\.tsx$/, reason: "legacy kanban column surface" },
  { pattern: /^components\/manager\/(?:ManagerTable|StatusCell)\.tsx$/, reason: "legacy manager dialogs and compact status switch" },
];

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isGloballyAllowed(file: string): boolean {
  return GLOBAL_ALLOWLIST.some((entry) => entry.pattern.test(file));
}

function isDirectPrimitiveAllowed(file: string): boolean {
  return DIRECT_PRIMITIVE_ALLOWLIST.some((entry) => entry.pattern.test(file));
}

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "playwright-report") continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    if (EXTENSIONS.has(extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

function lineNumberForOffset(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function lineAt(lines: string[], line: number): string {
  return (lines[line - 1] || "").trim();
}

function findPageContainerVariantFindings(file: string, content: string, lines: string[]): Finding[] {
  if (!file.startsWith("app/") && !file.startsWith("components/")) return [];

  const findings: Finding[] = [];
  const tagPattern = /<PageContainer\b[\s\S]*?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(content))) {
    const tag = match[0];
    if (/\bvariant\s*=/.test(tag)) continue;

    const line = lineNumberForOffset(content, match.index);
    if (lineAt(lines, line).startsWith("*")) continue;
    findings.push({
      file,
      line,
      ruleId: "page-container-explicit-variant",
      description: 'Authenticated pages should choose PageContainer variant="standard" or variant="analytics".',
      text: lineAt(lines, line),
    });
  }

  return findings;
}

function findDirectPrimitiveFindings(file: string, content: string, lines: string[]): Finding[] {
  if (isDirectPrimitiveAllowed(file)) return [];

  const importPattern = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  const findings: Finding[] = [];
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(content))) {
    const imports = match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0]);
    const source = match[2];
    const directImports = imports.filter((name) => {
      if (source === "@/components/ui/card") return name === "Card";
      if (source === "@/components/common/Modal") return name === "Modal";
      if (source === "@/components/ui/dialog") return name === "Dialog";
      if (source === "@/components/ui/switch") return name === "Switch";
      return false;
    });

    if (directImports.length === 0) continue;

    const line = lineNumberForOffset(content, match.index);
    findings.push({
      file,
      line,
      ruleId: "direct-primitive-import",
      description: "Prefer StandardCard, AppDialog, ToggleSwitch, or layout recipes before direct primitives.",
      text: lineAt(lines, line),
    });
  }

  return findings;
}

function findIconOnlyButtonFindings(file: string, content: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  lines.forEach((lineText, index) => {
    if (!/<Button\b/.test(lineText) || !/size=["']icon["']/.test(lineText)) return;
    if (/\baria-label\s*=|\btitle\s*=/.test(lineText)) return;

    const line = index + 1;
    findings.push({
      file,
      line,
      ruleId: "icon-button-accessible-label",
      description: 'Icon-only buttons need aria-label or title.',
      text: lineAt(lines, line),
    });
  });

  return findings;
}

function scanFile(filePath: string): Finding[] {
  const file = toPosix(relative(ROOT, filePath));
  if (isGloballyAllowed(file)) return [];

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];

  lines.forEach((lineText, index) => {
    for (const rule of REGEX_RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(lineText)) {
        findings.push({
          file,
          line: index + 1,
          ruleId: rule.id,
          description: rule.description,
          text: lineText.trim(),
        });
      }
    }
  });

  findings.push(...findPageContainerVariantFindings(file, content, lines));
  findings.push(...findDirectPrimitiveFindings(file, content, lines));
  findings.push(...findIconOnlyButtonFindings(file, content, lines));

  return findings;
}

const findings = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir))).flatMap(scanFile);

if (findings.length === 0) {
  console.log("Design-system check passed. No unapproved drift found.");
  process.exit(0);
}

console.error(`Design-system check found ${findings.length} issue(s):`);
for (const finding of findings) {
  console.error(`\n${finding.file}:${finding.line} [${finding.ruleId}] ${finding.description}`);
  console.error(`  ${finding.text}`);
}

console.error("\nDocument intentional exceptions in scripts/check-design-system.ts before allowlisting them.");
process.exit(1);
