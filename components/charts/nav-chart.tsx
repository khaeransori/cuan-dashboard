"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

interface NavDataPoint {
  timestamp: string
  nav: number
  totalValue: number
}

interface NavChartProps {
  data: NavDataPoint[]
  statistics?: {
    currentNav: number
    navChange: string
    highNav: number
    lowNav: number
  }
}

export function NavChart({ data, statistics }: NavChartProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  const formatNav = (value: number) => `$${value.toFixed(4)}`

  const navChange = statistics ? parseFloat(statistics.navChange) : 0
  const changeColor = navChange >= 0 ? "text-green-600" : "text-red-600"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>NAV History</CardTitle>
            <CardDescription>Net Asset Value per share over time</CardDescription>
          </div>
          {statistics && (
            <div className="text-right">
              <div className="text-2xl font-bold">${statistics.currentNav.toFixed(4)}</div>
              <div className={`text-sm ${changeColor}`}>
                {navChange >= 0 ? "+" : ""}{statistics.navChange}%
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatDate}
                className="text-xs"
              />
              <YAxis
                tickFormatter={formatNav}
                domain={["dataMin - 0.01", "dataMax + 0.01"]}
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
              <Line
                type="monotone"
                dataKey="nav"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {statistics && (
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">High:</span>{" "}
              <span className="font-medium">${statistics.highNav.toFixed(4)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Low:</span>{" "}
              <span className="font-medium">${statistics.lowNav.toFixed(4)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
