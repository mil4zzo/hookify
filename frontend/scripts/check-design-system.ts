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

type RuleAllowlistEntry = {
  pattern: RegExp;
  rules?: string[];
  reason: string;
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

const COLOR_RULES = ["hardcoded-tailwind-color", "large-radius", "raw-color", "emoji-icon"];
const DIRECT_PRIMITIVE_RULE = "direct-primitive-import";
const DIRECT_SKELETON_RULE = "direct-skeleton-import";
const INLINE_NOTICE_RULE = "inline-notice-pattern";
const WORKSPACE_LOADING_RULE = "workspace-state-loading";

const RULE_ALLOWLIST: RuleAllowlistEntry[] = [
  { pattern: /^components\/icons\//, rules: COLOR_RULES, reason: "brand icons keep official colors" },
  { pattern: /^components\/upload\/CreativePreview\.tsx$/, rules: [...COLOR_RULES, DIRECT_SKELETON_RULE], reason: "platform previews simulate ad surfaces" },
  { pattern: /^lib\/utils\/topBadgeStyles\.ts$/, rules: COLOR_RULES, reason: "centralized gold/silver/bronze badge recipes" },
  { pattern: /^components\/common\/TopBadge\.tsx$/, rules: COLOR_RULES, reason: "centralized gold/silver/bronze badge rendering" },
  { pattern: /^components\/common\/(?:Modal|AppDialog)\.tsx$/, rules: COLOR_RULES, reason: "runtime overlay opacity escape hatch" },
  { pattern: /^components\/charts\//, rules: [...COLOR_RULES, DIRECT_SKELETON_RULE], reason: "chart components compare computed runtime colors and render chart-shaped loading" },
  { pattern: /^app\/pv\/opengraph-image\.tsx$/, rules: COLOR_RULES, reason: "generated image fallback styling" },
  { pattern: /^app\/global-error\.tsx$/, rules: COLOR_RULES, reason: "framework-level fallback page before theme hydration" },
  { pattern: /^app\/design-system\/page\.tsx$/, reason: "design-system catalog demonstrates raw primitives and swatches" },

  { pattern: /^components\/ui\//, rules: [DIRECT_PRIMITIVE_RULE, DIRECT_SKELETON_RULE], reason: "low-level shadcn/Radix primitives" },
  { pattern: /^components\/common\/(?:Modal|AppDialog|StandardCard|ToggleSwitch|ConfirmDialog|AutoRefreshConfirmModal|BaseKanbanWidget|StatCard)\.tsx$/, rules: [DIRECT_PRIMITIVE_RULE], reason: "shared component definitions and legacy wrappers" },
  { pattern: /^components\/ads\//, rules: [DIRECT_PRIMITIVE_RULE], reason: "legacy detail/import dialogs are not part of primitive migration" },
  { pattern: /^components\/upload\//, rules: [DIRECT_PRIMITIVE_RULE], reason: "upload internals keep platform/media exceptions during this phase" },
  { pattern: /^components\/charts\//, rules: [DIRECT_PRIMITIVE_RULE], reason: "compact chart controls may use raw primitives" },
  { pattern: /^components\/layout\/Topbar\.tsx$/, rules: [DIRECT_PRIMITIVE_RULE, DIRECT_SKELETON_RULE], reason: "settings dialog is a legacy shell" },
  { pattern: /^app\/\(auth\)\//, rules: [DIRECT_PRIMITIVE_RULE], reason: "auth pages are outside authenticated app shell recipes" },
  { pattern: /^app\/onboarding\/steps\//, rules: [DIRECT_PRIMITIVE_RULE], reason: "onboarding cards migrate with the form-step pass" },
  { pattern: /^app\/(?:api-test|ui-demo|design-system|pv)\//, rules: [DIRECT_PRIMITIVE_RULE, DIRECT_SKELETON_RULE, INLINE_NOTICE_RULE], reason: "dev/demo/public surfaces" },
  { pattern: /^app\/insights\/page\.tsx$/, rules: [DIRECT_PRIMITIVE_RULE], reason: "legacy ad details modal remains until dialog migration phase" },
  { pattern: /^app\/packs\/page\.tsx$/, rules: [DIRECT_PRIMITIVE_RULE], reason: "legacy pack modals stay until dialog migration phase" },
  { pattern: /^components\/common\/PackFilter\.tsx$/, rules: [DIRECT_PRIMITIVE_RULE], reason: "legacy compact popover switch wrapper" },
  { pattern: /^components\/insights\/KanbanColumn\.tsx$/, rules: [DIRECT_PRIMITIVE_RULE], reason: "legacy kanban column surface" },
  { pattern: /^components\/manager\/(?:ManagerTable|StatusCell)\.tsx$/, rules: [DIRECT_PRIMITIVE_RULE], reason: "legacy manager dialogs and compact status switch" },

  { pattern: /^components\/common\/(?:States|RetentionVideoPlayer|ThumbnailImage|SparklineSkeleton|ActionTypeFilter|PackFilter)\.tsx$/, rules: [DIRECT_SKELETON_RULE], reason: "canonical state/media/filter skeleton definitions" },
  { pattern: /^components\/manager\/(?:TableContent|MinimalTableContent)\.tsx$/, rules: [DIRECT_SKELETON_RULE], reason: "dense table rows keep row-shaped skeletons" },
  { pattern: /^components\/ads\/AdDetailsDialog\.tsx$/, rules: [DIRECT_SKELETON_RULE], reason: "ad detail modal keeps media and chart-shaped skeletons" },
  { pattern: /^components\/ui\/date-range-picker\.tsx$/, rules: [DIRECT_SKELETON_RULE], reason: "low-level date picker loading primitive" },
  { pattern: /^app\/upload\/page\.tsx$/, rules: [DIRECT_SKELETON_RULE], reason: "upload previews keep media-shaped skeletons" },
];

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isRuleAllowed(file: string, ruleId: string): boolean {
  return RULE_ALLOWLIST.some((entry) => entry.pattern.test(file) && (!entry.rules || entry.rules.includes(ruleId)));
}

function hasLineException(lines: string[], line: number, ruleId: string): boolean {
  const candidates = [lines[line - 1], lines[line - 2]].filter(Boolean);
  return candidates.some((text) => {
    const match = text.match(/design-system-exception:\s*([a-z0-9-]+)\s+-\s*(\S.*)$/i);
    return !!match && match[1] === ruleId;
  });
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
  if (isRuleAllowed(file, "page-container-explicit-variant")) return [];
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
  if (isRuleAllowed(file, DIRECT_PRIMITIVE_RULE)) return [];

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

function findDirectSkeletonFindings(file: string, content: string, lines: string[]): Finding[] {
  if (isRuleAllowed(file, DIRECT_SKELETON_RULE)) return [];

  const importPattern = /import\s+\{([^}]+)\}\s+from\s+["']@\/components\/ui\/skeleton["']/g;
  const findings: Finding[] = [];
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(content))) {
    const imports = match[1].split(",").map((part) => part.trim().split(/\s+as\s+/)[0]);
    if (!imports.includes("Skeleton")) continue;

    const line = lineNumberForOffset(content, match.index);
    findings.push({
      file,
      line,
      ruleId: DIRECT_SKELETON_RULE,
      description: "Use StateSkeleton or a documented media/table/chart skeleton exception instead of importing Skeleton directly.",
      text: lineAt(lines, line),
    });
  }

  return findings;
}

function findInlineNoticeFindings(file: string, lines: string[]): Finding[] {
  if (isRuleAllowed(file, INLINE_NOTICE_RULE)) return [];

  const findings: Finding[] = [];
  lines.forEach((lineText, index) => {
    if (!/className=/.test(lineText)) return;
    if (/<\/?Button\b|<button\b|<span\b|hover:|cursor-|rounded-full/.test(lineText)) return;
    if (!/\bbg-(?:destructive|warning|attention|info)-/.test(lineText)) return;
    if (!/\bborder(?:-[btlrxy])?\b/.test(lineText)) return;
    if (!/\b(?:rounded|p[xy]?)-/.test(lineText)) return;
    if (/InlineNotice/.test(lineText)) return;

    const line = index + 1;
    findings.push({
      file,
      line,
      ruleId: INLINE_NOTICE_RULE,
      description: "Notice-like warning/info/error banners should use InlineNotice or a local design-system exception.",
      text: lineAt(lines, line),
    });
  });

  return findings;
}

function findIconOnlyButtonFindings(file: string, content: string, lines: string[]): Finding[] {
  if (isRuleAllowed(file, "icon-button-accessible-label")) return [];
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

function findWorkspaceLoadingFindings(file: string, lines: string[]): Finding[] {
  if (isRuleAllowed(file, WORKSPACE_LOADING_RULE)) return [];

  const findings: Finding[] = [];
  lines.forEach((lineText, index) => {
    if (!/<WorkspaceState\b/.test(lineText) || !/\bkind=["']loading["']/.test(lineText)) return;

    const line = index + 1;
    findings.push({
      file,
      line,
      ruleId: WORKSPACE_LOADING_RULE,
      description: "Page/workspace loading should render a structural StateSkeleton, not WorkspaceState kind=\"loading\".",
      text: lineAt(lines, line),
    });
  });

  return findings;
}

function findInvalidExceptionFindings(file: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  lines.forEach((lineText, index) => {
    if (!/design-system-exception:/.test(lineText)) return;
    if (/design-system-exception:\s*[a-z0-9-]+\s+-\s*\S/i.test(lineText)) return;

    findings.push({
      file,
      line: index + 1,
      ruleId: "invalid-design-system-exception",
      description: 'Use "// design-system-exception: rule-id - reason" so exceptions stay local and auditable.',
      text: lineText.trim(),
    });
  });
  return findings;
}

function scanFile(filePath: string): Finding[] {
  const file = toPosix(relative(ROOT, filePath));
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const findings: Finding[] = [];

  lines.forEach((lineText, index) => {
    for (const rule of REGEX_RULES) {
      if (isRuleAllowed(file, rule.id)) continue;
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
  findings.push(...findDirectSkeletonFindings(file, content, lines));
  findings.push(...findInlineNoticeFindings(file, lines));
  findings.push(...findIconOnlyButtonFindings(file, content, lines));
  findings.push(...findWorkspaceLoadingFindings(file, lines));
  findings.push(...findInvalidExceptionFindings(file, lines));

  return findings.filter((finding) => !isRuleAllowed(finding.file, finding.ruleId) && !hasLineException(lines, finding.line, finding.ruleId));
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

console.error('\nUse preferred primitives/states, or add a local "// design-system-exception: rule-id - reason" comment for rare intentional exceptions.');
process.exit(1);
