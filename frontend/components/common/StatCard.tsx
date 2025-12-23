"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { ComponentType, ReactNode } from "react";

interface StatCardProps {
  icon?: ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  title?: string;
  description?: string;
  additionalData?: Array<{ label: string; value: string | number | ReactNode }>;
  iconBgColor?: string;
  iconColor?: string;
  className?: string;
}

export function StatCard({ icon: IconComponent, value, label, title, description, additionalData, iconBgColor = "bg-brand-20", iconColor = "text-brand", className }: StatCardProps) {
  return (
    <Card className={cn("", className)}>
      {(title || description || IconComponent) && (
        <CardHeader>
          <CardTitle className={cn("flex items-center gap-2", IconComponent && "text-lg")}>
            {IconComponent && (
              <div className={cn("p-2 rounded-lg", iconBgColor)}>
                <IconComponent className={cn("w-5 h-5", iconColor)} />
              </div>
            )}
            {title || label}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-2xl font-bold">{value}</span>
          </div>
          {additionalData &&
            additionalData.map((item, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="font-semibold">{item.value}</span>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
