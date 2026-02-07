"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

interface ValueDataPoint {
  timestamp: string
  totalValue: number
  unrealizedPnl: number
}

interface PortfolioValueChartProps {
  data: ValueDataPoint[]
  currentValue?: number
  initialCapital?: number
}

export function PortfolioValueChart({ data, currentValue, initialCapital }: PortfolioValueChartProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  const formatValue = (value: number) => `$${value.toFixed(2)}`

  const pnl = currentValue && initialCapital ? currentValue - initialCapital : 0
  const pnlPercent = initialCapital && initialCapital > 0 ? (pnl / initialCapital) * 100 : 0
  const changeColor = pnl >= 0 ? "text-green-600" : "text-red-600"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Portfolio Value</CardTitle>
            <CardDescription>Total fund value over time</CardDescription>
          </div>
          {currentValue !== undefined && (
            <div className="text-right">
              <div className="text-2xl font-bold">${currentValue.toFixed(2)}</div>
              <div className={`text-sm ${changeColor}`}>
                {pnl >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}% ({pnl >= 0 ? "+" : ""}${pnl.toFixed(2)})
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatDate}
                className="text-xs"
              />
              <YAxis
                tickFormatter={formatValue}
                className="text-xs"
              />
              <Tooltip
                labelFormatter={(label) => new Date(label as string).toLocaleDateString()}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Area
                type="monotone"
                dataKey="totalValue"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#colorValue)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
