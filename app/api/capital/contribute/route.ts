import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getCurrentNav,
  calculateSharesForContribution,
  createSnapshot,
} from "@/lib/nav";
import { getAccountInfo, isConfigured } from "@/lib/binance";

interface ContributeRequest {
  investorId: string;
  amount: number;
  description?: string;
  txHash?: string;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admins can process contributions
  if (!session.user.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body: ContributeRequest = await request.json();
    const { investorId, amount, description, txHash } = body;

    if (!investorId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "Invalid request: investorId and positive amount required" },
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

    // Get current NAV
    const navData = await getCurrentNav();

    // Calculate shares to issue
    const sharesToIssue = calculateSharesForContribution(amount, navData.nav);

    // Create share transaction
    const shareTransaction = await prisma.shareTransaction.create({
      data: {
        investorId,
        type: "BUY",
        shares: sharesToIssue,
        navAtTransaction: navData.nav,
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
    let totalValue = navData.totalValue + amount;
    let availableUsdt = amount;
    let unrealizedPnl = 0;
    let marginUsed = 0;

    if (isConfigured()) {
      try {
        const liveData = await getAccountInfo();
        if (liveData) {
          totalValue = liveData.totalWalletBalance + amount;
          availableUsdt = liveData.availableBalance + amount;
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
        navAtTransaction: navData.nav,
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
