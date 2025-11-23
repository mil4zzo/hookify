"use client";

import { cn } from "@/lib/utils/cn";

interface TopBadgeProps {
  /** Variante do badge: gold (🥇), silver (🥈) ou copper (🥉) */
  variant: "gold" | "silver" | "copper";
  /** Texto do label do badge (ex: "CTR", "PAGE", "HOOK", "SPEND") */
  label: string;
  /** Classes CSS adicionais */
  className?: string;
}

const variantStyles = {
  gold: {
    emoji: "🥇",
    gradient: "linear-gradient(135deg, #FFD700 0%, #FFED4E 50%, #FFA500 100%)",
    shadow: "rgba(255, 215, 0, 0.4)",
    textColor: "#1a1a1a",
    textShadow: "0 1px 1px rgba(255, 255, 255, 0.3)",
  },
  silver: {
    emoji: "🥈",
    gradient: "linear-gradient(135deg, #C0C0C0 0%, #E8E8E8 50%, #A8A8A8 100%)",
    shadow: "rgba(192, 192, 192, 0.4)",
    textColor: "#1a1a1a",
    textShadow: "0 1px 1px rgba(255, 255, 255, 0.3)",
  },
  copper: {
    emoji: "🥉",
    gradient: "linear-gradient(135deg, #CD7F32 0%, #E39A5C 50%, #B87333 100%)",
    shadow: "rgba(205, 127, 50, 0.4)",
    textColor: "#1a1a1a",
    textShadow: "0 1px 1px rgba(255, 255, 255, 0.3)",
  },
};

export function TopBadge({ variant, label, className }: TopBadgeProps) {
  const styles = variantStyles[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 cursor-pointer transition-all duration-200",
        className
      )}
      style={{
        padding: "4px 10px 4px 6px",
        borderRadius: "4px",
        background: styles.gradient,
        boxShadow: `
          0 2px 8px ${styles.shadow},
          inset 0 1px 2px rgba(255, 255, 255, 0.3),
          inset 0 -1px 2px rgba(0, 0, 0, 0.1)
        `,
        border: "1px solid rgba(255, 255, 255, 0.2)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateX(4px)";
        e.currentTarget.style.boxShadow = `
          0 4px 12px ${styles.shadow},
          inset 0 1px 2px rgba(255, 255, 255, 0.3),
          inset 0 -1px 2px rgba(0, 0, 0, 0.1)
        `;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateX(0)";
        e.currentTarget.style.boxShadow = `
          0 2px 8px ${styles.shadow},
          inset 0 1px 2px rgba(255, 255, 255, 0.3),
          inset 0 -1px 2px rgba(0, 0, 0, 0.1)
        `;
      }}
    >
      <span
        style={{
          fontSize: "16px",
          lineHeight: 1,
          filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2))",
        }}
      >
        {styles.emoji}
      </span>
      <span
        style={{
          fontSize: "11px",
          fontWeight: "700",
          letterSpacing: "0.5px",
          color: styles.textColor,
          textShadow: styles.textShadow,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </span>
  );
}
