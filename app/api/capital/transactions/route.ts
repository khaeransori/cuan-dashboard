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
    const investorId = searchParams.get("investorId");
    const type = searchParams.get("type"); // CONTRIBUTION, REDEMPTION, or null for all
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Admin sees all, filter by investorId if provided
    const filterInvestorId = investorId || undefined;

    // Build where clause
    const where: {
      investorId?: string;
      type?: string;
    } = {};

    if (filterInvestorId) {
      where.investorId = filterInvestorId;
    }

    if (type && ["CONTRIBUTION", "REDEMPTION"].includes(type)) {
      where.type = type;
    }

    // Fetch transactions
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          investor: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
        orderBy: { timestamp: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.transaction.count({ where }),
    ]);

    // Also fetch share transactions for more detail
    const shareTransactions = await prisma.shareTransaction.findMany({
      where: filterInvestorId ? { investorId: filterInvestorId } : {},
      include: {
        investor: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
      take: limit,
      skip: offset,
    });

    return NextResponse.json({
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        description: tx.description,
        txHash: tx.txHash,
        timestamp: tx.timestamp,
        investor: tx.investor,
      })),
      shareTransactions: shareTransactions.map((st) => ({
        id: st.id,
        type: st.type,
        shares: st.shares,
        navAtTransaction: st.navAtTransaction,
        amount: st.amount,
        timestamp: st.timestamp,
        investor: st.investor,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + transactions.length < total,
      },
    });
  } catch (error) {
    console.error("Capital transactions API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
