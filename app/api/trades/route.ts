import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Auth: accepts either session OR webhook secret
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (session) return true;

  const webhookSecret = process.env.WEBHOOK_SECRET;
  const providedSecret = request.headers.get("X-Webhook-Secret");
  if (webhookSecret && providedSecret === webhookSecret) return true;

  return false;
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "50");
  const status = searchParams.get("status") || undefined;
  const symbol = searchParams.get("symbol") || undefined;

  try {
    // Build where clause
    const where: {
      status?: string;
      symbol?: string;
    } = {};

    if (status) {
      where.status = status;
    }
    if (symbol) {
      where.symbol = symbol;
    }

    // Fetch trades from database
    const trades = await prisma.trade.findMany({
      where,
      orderBy: { openedAt: "desc" },
      take: limit,
    });

    // Get stats from latest snapshot (pre-computed during sync)
    const latestSnapshot = await prisma.snapshot.findFirst({
      orderBy: { timestamp: "desc" },
      select: {
        totalTrades: true,
        wins: true,
        losses: true,
        totalPnl: true,
        winRate: true,
        avgWin: true,
        avgLoss: true,
      },
    });

    const stats = {
      totalTrades: latestSnapshot?.totalTrades ?? 0,
      wins: latestSnapshot?.wins ?? 0,
      losses: latestSnapshot?.losses ?? 0,
      winRate: latestSnapshot?.winRate ?? 0,
      totalPnl: latestSnapshot?.totalPnl ?? 0,
      netPnl: latestSnapshot?.totalPnl ?? 0, // For backward compatibility
      avgWin: latestSnapshot?.avgWin ?? 0,
      avgLoss: latestSnapshot?.avgLoss ?? 0,
    };

    return NextResponse.json({
      trades: trades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        positionSide: t.positionSide,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        quantity: t.quantity,
        leverage: t.leverage,
        pnl: t.pnl,
        pnlPercent: t.pnlPercent,
        status: t.status,
        openedAt: t.openedAt.toISOString(),
        closedAt: t.closedAt?.toISOString() ?? null,
        strategy: t.strategy,
        setup: t.setup,
        notes: t.notes,
        rating: t.rating,
      })),
      stats,
      pagination: {
        page: 1,
        limit,
        total: trades.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error("Trades API error:", error);
    return NextResponse.json({ error: "Failed to fetch trades" }, { status: 500 });
  }
}
