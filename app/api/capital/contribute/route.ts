import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentNav,
  calculateSharesForContribution,
  createSnapshot,
} from "@/lib/nav";
import { getAccountInfo, isConfigured } from "@/lib/binance";
import { requireAdmin } from "@/lib/api-auth";

interface ContributeRequest {
  investorId: string;
  amount: number;
  description?: string;
  txHash?: string;
  navOverride?: number; // Lock NAV for batch contributions (admin only)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: ContributeRequest = await request.json();
    const { investorId, amount, description, txHash, navOverride } = body;

    if (!investorId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "Invalid request: investorId and positive amount required" },
        { status: 400 }
      );
    }

    if (navOverride !== undefined && navOverride <= 0) {
      return NextResponse.json(
        { error: "navOverride must be a positive number" },
        { status: 400 }
      );
    }

    // Verify investor exists
    const investor = await prisma.investor.findUnique({
      where: { id: investorId },
    });

    if (!investor) {
      return NextResponse.json({ error: "Investor not found" }, { status: 404 });
    }

    // Get current NAV — use navOverride if provided (for batch contributions)
    const navData = await getCurrentNav();
    const effectiveNav = navOverride ?? navData.nav;

    // Calculate shares to issue using effective NAV
    const sharesToIssue = calculateSharesForContribution(amount, effectiveNav);

    // Create share transaction
    const shareTransaction = await prisma.shareTransaction.create({
      data: {
        investorId,
        type: "BUY",
        shares: sharesToIssue,
        navAtTransaction: effectiveNav,
        amount,
      },
    });

    // Create capital transaction record
    const transaction = await prisma.transaction.create({
      data: {
        type: "CONTRIBUTION",
        amount,
        currency: "USDT",
        investorId,
        description: description || `Capital contribution of ${amount} USDT`,
        txHash,
      },
    });

    // Get current portfolio value for snapshot
    // Use Binance wallet balance as source of truth — do NOT add amount again
    // because the deposit is already reflected in totalWalletBalance
    let totalValue = navData.totalValue + amount;
    let availableUsdt = amount;
    let unrealizedPnl = 0;
    let marginUsed = 0;

    if (isConfigured()) {
      try {
        const liveData = await getAccountInfo();
        if (liveData) {
          totalValue = liveData.totalWalletBalance;
          availableUsdt = liveData.availableBalance;
          unrealizedPnl = liveData.totalUnrealizedProfit;
          marginUsed = liveData.totalPositionInitialMargin;
        }
      } catch (error) {
        console.error("Failed to fetch Binance data for snapshot:", error);
      }
    }

    // Create snapshot after contribution
    await createSnapshot(
      totalValue,
      availableUsdt,
      unrealizedPnl,
      marginUsed,
      "contribution"
    );

    return NextResponse.json({
      success: true,
      shareTransaction: {
        id: shareTransaction.id,
        shares: sharesToIssue,
        navAtTransaction: effectiveNav,
        navWasOverridden: !!navOverride,
        amount,
      },
      transaction: {
        id: transaction.id,
        type: transaction.type,
        amount: transaction.amount,
      },
      investor: {
        id: investor.id,
        name: investor.name,
      },
    });
  } catch (error) {
    console.error("Contribution API error:", error);
    return NextResponse.json(
      { error: "Failed to process contribution" },
      { status: 500 }
    );
  }
}
