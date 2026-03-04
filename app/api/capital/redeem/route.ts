import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getCurrentNav,
  getInvestorShares,
  calculateAmountForRedemption,
  createSnapshot,
} from "@/lib/nav";
import { getAccountInfo, isConfigured } from "@/lib/binance";

interface RedeemRequest {
  investorId: string;
  shares: number;
  description?: string;
  txHash?: string;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admins can process redemptions
  if (!session.user.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body: RedeemRequest = await request.json();
    const { investorId, shares, description, txHash } = body;

    if (!investorId || !shares || shares <= 0) {
      return NextResponse.json(
        { error: "Invalid request: investorId and positive shares required" },
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

    // Get investor's current shares
    const currentShares = await getInvestorShares(investorId);

    if (shares > currentShares) {
      return NextResponse.json(
        { error: `Insufficient shares. Available: ${currentShares}, requested: ${shares}` },
        { status: 400 }
      );
    }

    // Get current NAV
    const navData = await getCurrentNav();

    // Calculate redemption amount
    const redemptionAmount = calculateAmountForRedemption(shares, navData.nav);

    // Create share transaction (negative shares for redemption)
    const shareTransaction = await prisma.shareTransaction.create({
      data: {
        investorId,
        type: "SELL",
        shares: -shares, // Negative to reduce holdings
        navAtTransaction: navData.nav,
        amount: -redemptionAmount, // Negative as it's an outflow
      },
    });

    // Create capital transaction record
    const transaction = await prisma.transaction.create({
      data: {
        type: "REDEMPTION",
        amount: -redemptionAmount, // Negative for outflow
        currency: "USDT",
        investorId,
        description: description || `Redemption of ${shares} shares for ${redemptionAmount.toFixed(2)} USDT`,
        txHash,
      },
    });

    // Get current portfolio value for snapshot
    // Use Binance wallet balance as source of truth — do NOT subtract amount again
    // because the withdrawal is already reflected in totalWalletBalance
    let totalValue = navData.totalValue - redemptionAmount;
    let availableUsdt = 0;
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

    // Create snapshot after redemption
    await createSnapshot(
      totalValue,
      availableUsdt,
      unrealizedPnl,
      marginUsed,
      "redemption"
    );

    return NextResponse.json({
      success: true,
      shareTransaction: {
        id: shareTransaction.id,
        shares: -shares,
        navAtTransaction: navData.nav,
        redemptionAmount,
      },
      transaction: {
        id: transaction.id,
        type: transaction.type,
        amount: redemptionAmount,
      },
      investor: {
        id: investor.id,
        name: investor.name,
        remainingShares: currentShares - shares,
      },
    });
  } catch (error) {
    console.error("Redemption API error:", error);
    return NextResponse.json(
      { error: "Failed to process redemption" },
      { status: 500 }
    );
  }
}
