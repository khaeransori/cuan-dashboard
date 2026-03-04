import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30");
    const limit = parseInt(searchParams.get("limit") || "100");

    // Calculate date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch snapshots
    const snapshots = await prisma.snapshot.findMany({
      where: {
        timestamp: {
          gte: startDate,
        },
      },
      orderBy: { timestamp: "asc" },
      take: limit,
    });

    // Calculate statistics
    const navValues = snapshots.map((s) => s.nav);
    const latestNav = navValues[navValues.length - 1] || 1;
    const initialNav = navValues[0] || 1;
    const navChange = ((latestNav - initialNav) / initialNav) * 100;

    // Calculate high/low
    const highNav = Math.max(...navValues);
    const lowNav = Math.min(...navValues);

    // Calculate daily returns for volatility
    const dailyReturns: number[] = [];
    for (let i = 1; i < navValues.length; i++) {
      const dailyReturn = (navValues[i] - navValues[i - 1]) / navValues[i - 1];
      dailyReturns.push(dailyReturn);
    }

    // Calculate volatility (standard deviation of returns)
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length || 0;
    const variance =
      dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
        dailyReturns.length || 0;
    const volatility = Math.sqrt(variance) * Math.sqrt(365) * 100; // Annualized

    return NextResponse.json({
      history: snapshots.map((s) => ({
        timestamp: s.timestamp,
        nav: s.nav,
        totalValue: s.totalValue,
        totalShares: s.totalShares,
        unrealizedPnl: s.unrealizedPnl,
        trigger: s.trigger,
      })),
      statistics: {
        currentNav: latestNav,
        initialNav,
        navChange: navChange.toFixed(2),
        highNav,
        lowNav,
        volatility: volatility.toFixed(2),
        dataPoints: snapshots.length,
        periodDays: days,
      },
    });
  } catch (error) {
    console.error("NAV history API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch NAV history" },
      { status: 500 }
    );
  }
}
