import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountInfo, getPositions, isConfigured } from "@/lib/binance";
import { getCurrentNav, getAllInvestorShares } from "@/lib/nav";
import { requireAdmin } from "@/lib/api-auth";

interface BinancePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  leverage: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get NAV data
    const navData = await getCurrentNav();

    // Get investor shares
    const investorShares = await getAllInvestorShares();

    // Get latest snapshot
    const latestSnapshot = await prisma.snapshot.findFirst({
      orderBy: { timestamp: "desc" },
    });

    // Calculate trade stats from DATABASE (not Binance)
    const closedTrades = await prisma.trade.findMany({
      where: { status: "CLOSED", pnl: { not: null } },
    });
    const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
    const losses = closedTrades.filter((t) => (t.pnl ?? 0) < 0);
    const totalPnlFromTrades = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    const tradeStats = {
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      totalPnl: totalPnlFromTrades,
      winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
    };

    // Try to get live data from Binance if configured
    let liveData = null;
    let positions: BinancePosition[] = [];

    if (isConfigured()) {
      try {
        liveData = await getAccountInfo();
        positions = await getPositions();

        // Update NAV with live data if available
        if (liveData) {
          navData.totalValue = liveData.totalWalletBalance;
          navData.nav = navData.totalShares > 0 ? liveData.totalWalletBalance / navData.totalShares : 1.0;

          // Recalculate investor values with live NAV
          investorShares.forEach((inv) => {
            inv.value = inv.shares * navData.nav;
            inv.pnl = inv.value - inv.costBasis;
            inv.pnlPercent = inv.costBasis > 0 ? (inv.pnl / inv.costBasis) * 100 : 0;
          });
        }
      } catch (error) {
        console.error("Failed to fetch Binance data:", error);
      }
    }

    // Calculate portfolio value
    const totalValue = liveData?.totalWalletBalance ?? latestSnapshot?.totalValue ?? 18;
    const unrealizedPnl = liveData?.totalUnrealizedProfit ?? latestSnapshot?.unrealizedPnl ?? 0;
    const availableBalance = liveData?.availableBalance ?? latestSnapshot?.availableUsdt ?? totalValue;

    // Initial capital from cost basis
    const initialCapital = investorShares.reduce((sum, inv) => sum + inv.costBasis, 0);
    const totalPnlFromStart = totalValue - initialCapital;
    const totalPnlPercent = initialCapital > 0 ? (totalPnlFromStart / initialCapital) * 100 : 0;

    return NextResponse.json({
      portfolio: {
        totalValue,
        initialCapital,
        unrealizedPnl,
        availableBalance,
        marginUsed: liveData?.totalPositionInitialMargin ?? latestSnapshot?.marginUsed ?? 0,
        totalPnl: totalPnlFromStart,
        totalPnlPercent,
      },
      // NAV data
      nav: navData.nav,
      totalShares: navData.totalShares,
      // Investor data (replaces founders)
      investors: investorShares.map((inv) => ({
        id: inv.investorId,
        name: inv.name,
        shares: inv.shares,
        value: inv.value,
        costBasis: inv.costBasis,
        pnl: inv.pnl,
        pnlPercent: inv.pnlPercent,
      })),
      positions: positions.map((p) => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? "LONG" : "SHORT",
        quantity: Math.abs(parseFloat(p.positionAmt)),
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        unrealizedPnl: parseFloat(p.unRealizedProfit),
        leverage: parseInt(p.leverage),
      })),
      stats: tradeStats,
      binanceConfigured: isConfigured(),
      lastUpdated: new Date(),
    });
  } catch (error) {
    console.error("Portfolio API error:", error);
    return NextResponse.json({ error: "Failed to fetch portfolio data" }, { status: 500 });
  }
}
