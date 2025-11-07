"use client";

import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ActionTypeFilterProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  className?: string;
  placeholder?: string;
}

export function ActionTypeFilter({ 
  label = "Evento de Conversão", 
  value, 
  onChange, 
  options, 
  className,
  placeholder = "Evento de Conversão"
}: ActionTypeFilterProps) {
  return (
    <div className={`space-y-2 ${className || ""}`}>
      {label && <label className="text-sm font-medium">{label}</label>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

