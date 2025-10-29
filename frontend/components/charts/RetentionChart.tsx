"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Eye } from "lucide-react";

interface RetentionChartProps {
  videoPlayCurve: number[];
}

export function RetentionChart({ videoPlayCurve }: RetentionChartProps) {
  // Converte o array de retenção em dados para o gráfico usando useMemo
  const chartData = useMemo(() => {
    return videoPlayCurve.map((value, index) => {
      let label = "";

      if (index < 15) {
        label = `${index}s`;
      } else {
        const labels = ["15-20s", "20-25s", "25-30s", "30-40s", "40-50s", "50-60s", "60s+"];
        label = labels[index - 15] || `${index}s`;
      }

      return {
        second: label,
        retention: Math.round(value * 100) / 100, // Arredonda para 2 casas decimais
        index: index,
      };
    });
  }, [videoPlayCurve]);

  // Tooltip customizado
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-surface2 border border-surface2 rounded-lg p-3 shadow-lg">
          <p className="text-sm font-medium">{`Tempo: ${label}`}</p>
          <p className="text-sm text-brand">{`Retenção: ${payload[0].value.toFixed(2)}%`}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Eye className="w-5 h-5 text-brand" />
          👁️ Retention Graph
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{
                top: 10,
                right: 30,
                left: 0,
                bottom: 0,
              }}
            >
              <defs>
                <linearGradient id="retentionGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#172654" stopOpacity={0.8} />
                  <stop offset="100%" stopColor="#61a7f9" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--surface2))" opacity={0.3} />
              <XAxis dataKey="second" stroke="hsl(var(--muted))" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted))" fontSize={12} tickLine={false} axisLine={false} domain={[0, "dataMax"]} tickFormatter={(value) => `${value}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="retention"
                stroke="#172654"
                strokeWidth={2}
                fill="url(#retentionGradient)"
                dot={false}
                activeDot={{
                  r: 4,
                  fill: "#172654",
                  stroke: "#fff",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Informações adicionais */}
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="text-center">
            <div className="text-lg font-semibold text-brand">{chartData[0]?.retention.toFixed(1)}%</div>
            <div className="text-xs text-muted">Retention at 0s</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-brand">{chartData[2]?.retention.toFixed(1)}%</div>
            <div className="text-xs text-muted">Retention at 3s</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
