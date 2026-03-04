import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountInfo, isConfigured } from "@/lib/binance";
import { createSnapshot } from "@/lib/nav";
import { requireAdmin } from "@/lib/api-auth";

/**
 * POST /api/capital/rebalance
 * 
 * Rebalances shares equally among all investors.
 * Each investor ends up with totalShares / numInvestors.
 * 
 * Query params:
 *   ?dryRun=true  — preview only, no changes
 * 
 * Admin only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";

  try {
    // Get all investors with their share transactions
    const investors = await prisma.investor.findMany({
      include: { shareTransactions: true },
    });

    if (investors.length === 0) {
      return NextResponse.json({ error: "No investors found" }, { status: 400 });
    }

    // Calculate current shares per investor
    const currentHoldings = investors.map((inv) => {
      const shares = inv.shareTransactions.reduce((sum, tx) => sum + tx.shares, 0);
      const costBasis = inv.shareTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      return {
        id: inv.id,
        name: inv.name,
        currentShares: shares,
        costBasis,
      };
    });

    const totalShares = currentHoldings.reduce((sum, h) => sum + h.currentShares, 0);
    const equalShares = totalShares / investors.length;

    // Get current NAV
    let totalValue = 0;
    let nav = 1.0;

    if (isConfigured()) {
      try {
        const liveData = await getAccountInfo();
        if (liveData) {
          totalValue = liveData.totalWalletBalance;
          nav = totalShares > 0 ? totalValue / totalShares : 1.0;
        }
      } catch {
        // Use snapshot fallback
        const snapshot = await prisma.snapshot.findFirst({ orderBy: { timestamp: "desc" } });
        if (snapshot) {
          totalValue = snapshot.totalValue;
          nav = snapshot.nav;
        }
      }
    } else {
      const snapshot = await prisma.snapshot.findFirst({ orderBy: { timestamp: "desc" } });
      if (snapshot) {
        totalValue = snapshot.totalValue;
        nav = snapshot.nav;
      }
    }

    // Calculate adjustments
    const adjustments = currentHoldings.map((h) => {
      const delta = equalShares - h.currentShares;
      const deltaValue = delta * nav;
      return {
        investorId: h.id,
        name: h.name,
        before: h.currentShares,
        after: equalShares,
        delta,
        deltaValue,
        costBasis: h.costBasis,
        newValue: equalShares * nav,
      };
    });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        nav,
        totalValue,
        totalShares,
        equalShares,
        adjustments,
        message: "No changes made. Remove ?dryRun=true to execute.",
      });
    }

    // Execute rebalance — create adjustment share transactions
    const results = [];
    for (const adj of adjustments) {
      if (Math.abs(adj.delta) < 0.0001) {
        results.push({ ...adj, action: "no_change" });
        continue;
      }

      await prisma.shareTransaction.create({
        data: {
          investorId: adj.investorId,
          type: "REBALANCE",
          shares: adj.delta,
          navAtTransaction: nav,
          amount: adj.deltaValue,
        },
      });

      results.push({ ...adj, action: adj.delta > 0 ? "added" : "removed" });
    }

    // Create snapshot after rebalance
    if (isConfigured()) {
      try {
        const liveData = await getAccountInfo();
        if (liveData) {
          await createSnapshot(
            liveData.totalWalletBalance,
            liveData.availableBalance,
            liveData.totalUnrealizedProfit,
            liveData.totalPositionInitialMargin,
            "manual"
          );
        }
      } catch {
        // Skip snapshot on error
      }
    }

    return NextResponse.json({
      success: true,
      nav,
      totalValue,
      totalShares,
      equalShares,
      adjustments: results,
      message: `Rebalanced ${investors.length} investors to ${equalShares.toFixed(4)} shares each at NAV ${nav.toFixed(4)}`,
    });
  } catch (error) {
    console.error("Rebalance API error:", error);
    return NextResponse.json(
      { error: "Failed to rebalance shares" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/capital/rebalance
 * 
 * Preview current vs equal distribution (same as POST ?dryRun=true)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const investors = await prisma.investor.findMany({
      include: { shareTransactions: true },
    });

    const currentHoldings = investors.map((inv) => {
      const shares = inv.shareTransactions.reduce((sum, tx) => sum + tx.shares, 0);
      const costBasis = inv.shareTransactions.reduce((sum, tx) => sum + tx.amount, 0);
      return {
        id: inv.id,
        name: inv.name,
        currentShares: shares,
        costBasis,
      };
    });

    const totalShares = currentHoldings.reduce((sum, h) => sum + h.currentShares, 0);
    const equalShares = totalShares / investors.length;

    // Get NAV
    const snapshot = await prisma.snapshot.findFirst({ orderBy: { timestamp: "desc" } });
    const nav = snapshot?.nav ?? 1.0;
    const totalValue = snapshot?.totalValue ?? totalShares;

    const preview = currentHoldings.map((h) => ({
      name: h.name,
      currentShares: h.currentShares,
      targetShares: equalShares,
      delta: equalShares - h.currentShares,
      currentValue: h.currentShares * nav,
      targetValue: equalShares * nav,
    }));

    return NextResponse.json({
      preview: true,
      nav,
      totalValue,
      totalShares,
      equalShares,
      investors: preview,
      hint: "POST /api/capital/rebalance to execute (or ?dryRun=true to preview with live data)",
    });
  } catch (error) {
    console.error("Rebalance preview error:", error);
    return NextResponse.json(
      { error: "Failed to preview rebalance" },
      { status: 500 }
    );
  }
}
