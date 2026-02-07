import { prisma } from "@/lib/prisma";

export interface NavData {
  totalValue: number;
  totalShares: number;
  nav: number;
  timestamp: Date;
}

export interface InvestorShares {
  investorId: string;
  name: string;
  shares: number;
  value: number;
  costBasis: number;
  pnl: number;
  pnlPercent: number;
}

/**
 * Get current NAV from latest snapshot
 */
export async function getCurrentNav(): Promise<NavData> {
  const latestSnapshot = await prisma.snapshot.findFirst({
    orderBy: { timestamp: "desc" },
  });

  if (!latestSnapshot) {
    return {
      totalValue: 18,
      totalShares: 18,
      nav: 1.0,
      timestamp: new Date(),
    };
  }

  return {
    totalValue: latestSnapshot.totalValue,
    totalShares: latestSnapshot.totalShares,
    nav: latestSnapshot.nav,
    timestamp: latestSnapshot.timestamp,
  };
}

/**
 * Get total shares for a single investor
 */
export async function getInvestorShares(investorId: string): Promise<number> {
  const transactions = await prisma.shareTransaction.findMany({
    where: { investorId },
  });

  return transactions.reduce((total, tx) => total + tx.shares, 0);
}

/**
 * Get all investors with their share holdings and calculated values
 */
export async function getAllInvestorShares(): Promise<InvestorShares[]> {
  const investors = await prisma.investor.findMany({
    include: {
      shareTransactions: true,
    },
  });

  const navData = await getCurrentNav();

  return investors.map((investor) => {
    const shares = investor.shareTransactions.reduce(
      (total, tx) => total + tx.shares,
      0
    );
    const costBasis = investor.shareTransactions.reduce(
      (total, tx) => total + tx.amount,
      0
    );
    const value = shares * navData.nav;
    const pnl = value - costBasis;
    const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

    return {
      investorId: investor.id,
      name: investor.name,
      shares,
      value,
      costBasis,
      pnl,
      pnlPercent,
    };
  });
}

/**
 * Calculate shares to issue for a contribution amount
 */
export function calculateSharesForContribution(
  amount: number,
  currentNav: number
): number {
  return amount / currentNav;
}

/**
 * Calculate redemption amount for shares
 */
export function calculateAmountForRedemption(
  shares: number,
  currentNav: number
): number {
  return shares * currentNav;
}

export interface TradingStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

/**
 * Calculate trading stats from all closed trades
 */
export async function calculateTradingStats(): Promise<TradingStats> {
  const closedTrades = await prisma.trade.findMany({
    where: { status: "CLOSED", pnl: { not: null } },
    select: { pnl: true },
  });

  const winTrades = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const lossTrades = closedTrades.filter((t) => (t.pnl ?? 0) < 0);
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const avgWin = winTrades.length > 0
    ? winTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / winTrades.length
    : 0;
  const avgLoss = lossTrades.length > 0
    ? lossTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / lossTrades.length
    : 0;

  return {
    totalTrades: closedTrades.length,
    wins: winTrades.length,
    losses: lossTrades.length,
    totalPnl,
    winRate: closedTrades.length > 0 ? (winTrades.length / closedTrades.length) * 100 : 0,
    avgWin,
    avgLoss,
  };
}

/**
 * Create a new portfolio snapshot with NAV and trading stats
 */
export async function createSnapshot(
  totalValue: number,
  availableUsdt: number,
  unrealizedPnl: number,
  marginUsed: number,
  trigger: "daily" | "contribution" | "redemption" | "manual" | "sync",
  btcPrice?: number
): Promise<void> {
  const allShares = await prisma.shareTransaction.findMany();
  const totalShares = allShares.reduce((sum, tx) => sum + tx.shares, 0);
  const nav = totalShares > 0 ? totalValue / totalShares : 1.0;

  // Calculate trading stats from all closed trades
  const stats = await calculateTradingStats();

  await prisma.snapshot.create({
    data: {
      totalValue,
      totalShares,
      nav,
      availableUsdt,
      unrealizedPnl,
      marginUsed,
      btcPrice,
      trigger,
      totalTrades: stats.totalTrades,
      wins: stats.wins,
      losses: stats.losses,
      totalPnl: stats.totalPnl,
      winRate: stats.winRate,
      avgWin: stats.avgWin,
      avgLoss: stats.avgLoss,
    },
  });
}
