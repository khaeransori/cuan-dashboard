"use client"

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

interface Investor {
  id: string
  name: string
  shares: number
  value: number
  pnlPercent: number
}

interface InvestorPieChartProps {
  investors: Investor[]
  totalShares: number
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", "#82CA9D"]

export function InvestorPieChart({ investors, totalShares }: InvestorPieChartProps) {
  const data = investors.map((inv) => ({
    name: inv.name,
    value: inv.shares,
    percentage: ((inv.shares / totalShares) * 100).toFixed(1),
    usdValue: inv.value,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ownership Distribution</CardTitle>
        <CardDescription>Share allocation among investors</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 space-y-2">
          {investors.map((inv, idx) => (
            <div key={inv.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <span>{inv.name}</span>
                <span className="text-muted-foreground">
                  ({((inv.shares / totalShares) * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="text-right">
                <span className="font-medium">${inv.value.toFixed(2)}</span>
                <span className={`ml-2 text-xs ${inv.pnlPercent >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {inv.pnlPercent >= 0 ? "+" : ""}{inv.pnlPercent.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
