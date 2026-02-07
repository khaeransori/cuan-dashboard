import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccountInfo, isConfigured } from "@/lib/binance";
import { createSnapshot } from "@/lib/nav";
import crypto from "crypto";

// Auth: accepts either session OR webhook secret
async function isAuthorized(request: NextRequest): Promise<boolean> {
  // Check session first (dashboard users)
  const session = await getServerSession(authOptions);
  if (session) return true;

  // Check webhook secret (bot)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const providedSecret = request.headers.get("X-Webhook-Secret");
  if (webhookSecret && providedSecret === webhookSecret) return true;

  return false;
}

const BINANCE_FUTURES_URL = "https://fapi.binance.com";

interface BinanceTrade {
  id: number;
  symbol: string;
  orderId: number;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT" | "BOTH";
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  time: number;
}

async function signedRequest(
  endpoint: string,
  params: Record<string, string | number> = {}
) {
  const apiKey = process.env.BINANCE_API_KEY || "";
  const apiSecret = process.env.BINANCE_API_SECRET || "";

  const timestamp = Date.now();
  const queryParams = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
    timestamp: String(timestamp),
  });

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(queryParams.toString())
    .digest("hex");
  queryParams.append("signature", signature);

  const response = await fetch(
    `${BINANCE_FUTURES_URL}${endpoint}?${queryParams.toString()}`,
    {
      headers: { "X-MBX-APIKEY": apiKey },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Binance API error: ${error.msg || response.statusText}`);
  }

  return response.json();
}

async function syncTrades(): Promise<number> {
  // Get the most recent trade in database
  const latestTrade = await prisma.trade.findFirst({
    orderBy: { openedAt: "desc" },
    select: { openedAt: true },
  });

  // Fetch only trades newer than our latest
  const params: Record<string, string | number> = { limit: 500 };
  if (latestTrade) {
    params.startTime = latestTrade.openedAt.getTime() + 1;
  }

  const trades: BinanceTrade[] = await signedRequest(
    "/fapi/v1/userTrades",
    params
  );

  if (trades.length === 0) return 0;

  // Group trades by orderId
  const orderMap = new Map<
    string,
    {
      symbol: string;
      side: string;
      positionSide: string;
      fills: BinanceTrade[];
      totalQty: number;
      totalPnl: number;
      totalCommission: number;
      avgPrice: number;
      firstTime: number;
      lastTime: number;
    }
  >();

  for (const trade of trades) {
    const key = `${trade.symbol}-${trade.orderId}`;
    if (!orderMap.has(key)) {
      orderMap.set(key, {
        symbol: trade.symbol,
        side: trade.side,
        positionSide: trade.positionSide,
        fills: [],
        totalQty: 0,
        totalPnl: 0,
        totalCommission: 0,
        avgPrice: 0,
        firstTime: trade.time,
        lastTime: trade.time,
      });
    }
    const order = orderMap.get(key)!;
    order.fills.push(trade);
    order.totalQty += parseFloat(trade.qty);
    order.totalPnl += parseFloat(trade.realizedPnl);
    order.totalCommission += parseFloat(trade.commission);
    order.firstTime = Math.min(order.firstTime, trade.time);
    order.lastTime = Math.max(order.lastTime, trade.time);
  }

  // Calculate average price
  for (const order of orderMap.values()) {
    let totalValue = 0;
    let totalQty = 0;
    for (const fill of order.fills) {
      const qty = parseFloat(fill.qty);
      totalValue += parseFloat(fill.price) * qty;
      totalQty += qty;
    }
    order.avgPrice = totalQty > 0 ? totalValue / totalQty : 0;
  }

  // Insert new trades
  let synced = 0;
  for (const [, order] of orderMap) {
    const binanceId = `${order.symbol}-${order.fills[0].orderId}`;

    const existing = await prisma.trade.findUnique({ where: { binanceId } });
    if (existing) continue;

    const hasPnl = order.totalPnl !== 0;

    await prisma.trade.create({
      data: {
        binanceId,
        symbol: order.symbol,
        side: order.side,
        positionSide: order.positionSide,
        entryPrice: order.avgPrice,
        exitPrice: hasPnl ? order.avgPrice : null,
        quantity: order.totalQty,
        pnl: hasPnl ? order.totalPnl : null,
        pnlPercent:
          hasPnl && order.avgPrice > 0
            ? (order.totalPnl / (order.avgPrice * order.totalQty)) * 100
            : null,
        commission: order.totalCommission,
        status: hasPnl ? "CLOSED" : "OPEN",
        openedAt: new Date(order.firstTime),
        closedAt: hasPnl ? new Date(order.lastTime) : null,
      },
    });
    synced++;
  }

  return synced;
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Binance API not configured" },
      { status: 400 }
    );
  }

  try {
    // 1. Sync account balance and create snapshot
    const accountInfo = await getAccountInfo();

    if (!accountInfo) {
      return NextResponse.json(
        { error: "Failed to fetch Binance data" },
        { status: 500 }
      );
    }

    await createSnapshot(
      accountInfo.totalWalletBalance,
      accountInfo.availableBalance,
      accountInfo.totalUnrealizedProfit,
      accountInfo.totalPositionInitialMargin,
      "sync"
    );

    // 2. Sync new trades
    const tradesSynced = await syncTrades();

    // Get the latest snapshot
    const snapshot = await prisma.snapshot.findFirst({
      orderBy: { timestamp: "desc" },
    });

    return NextResponse.json({
      success: true,
      snapshot,
      tradesSynced,
    });
  } catch (error) {
    console.error("Sync API error:", error);
    return NextResponse.json(
      { error: "Failed to sync data" },
      { status: 500 }
    );
  }
}
