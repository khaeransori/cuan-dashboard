"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NavChart } from "@/components/charts/nav-chart";
import { PortfolioValueChart } from "@/components/charts/portfolio-value-chart";
import { InvestorPieChart } from "@/components/charts/investor-pie-chart";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, LogOut, TrendingUp, TrendingDown, Wallet, Users, BarChart3, AlertCircle, DollarSign, Plus, Minus, Settings } from "lucide-react";
import Link from "next/link";

interface PortfolioData {
  portfolio: {
    totalValue: number;
    initialCapital: number;
    unrealizedPnl: number;
    availableBalance: number;
    marginUsed: number;
    totalPnl: number;
    totalPnlPercent: number;
  };
  nav: number;
  totalShares: number;
  investors: Array<{
    id: string;
    name: string;
    shares: number;
    value: number;
    costBasis: number;
    pnl: number;
    pnlPercent: number;
  }>;
  positions: Array<{
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    leverage: number;
  }>;
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
  };
  binanceConfigured: boolean;
  lastUpdated: string;
}

interface TradesData {
  trades: Array<{
    id: string;
    symbol: string;
    side: string;
    positionSide: string;
    entryPrice: number;
    exitPrice: number | null;
    quantity: number;
    leverage: number;
    pnl: number | null;
    pnlPercent: number | null;
    status: string;
    openedAt: string;
    closedAt: string | null;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface NavHistory {
  history: Array<{
    timestamp: string;
    nav: number;
    totalValue: number;
    totalShares: number;
    unrealizedPnl: number;
    trigger: string;
  }>;
  statistics: {
    currentNav: number;
    initialNav: number;
    navChange: string;
    highNav: number;
    lowNav: number;
    volatility: string;
    dataPoints: number;
    periodDays: number;
  };
}

interface CapitalTransactions {
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    currency: string;
    description: string;
    timestamp: string;
    investor: { name: string } | null;
  }>;
  shareTransactions: Array<{
    id: string;
    type: string;
    shares: number;
    navAtTransaction: number;
    amount: number;
    timestamp: string;
    investor: { name: string };
  }>;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [trades, setTrades] = useState<TradesData | null>(null);
  const [navHistory, setNavHistory] = useState<NavHistory | null>(null);
  const [capitalTxs, setCapitalTxs] = useState<CapitalTransactions | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  // Admin form state
  const [txType, setTxType] = useState<"contribution" | "redemption">("contribution");
  const [selectedInvestor, setSelectedInvestor] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txShares, setTxShares] = useState("");
  const [txDescription, setTxDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchData();
    }
  }, [status]);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const [portfolioRes, tradesRes, navRes, capitalRes] = await Promise.all([
        fetch("/api/portfolio"),
        fetch("/api/trades?limit=10"),
        fetch("/api/nav/history?days=30"),
        fetch("/api/capital/transactions?limit=20"),
      ]);

      if (!portfolioRes.ok) {
        throw new Error("Failed to fetch portfolio data");
      }

      const portfolioData = await portfolioRes.json();
      setPortfolio(portfolioData);

      if (tradesRes.ok) {
        setTrades(await tradesRes.json());
      }
      if (navRes.ok) {
        setNavHistory(await navRes.json());
      }
      if (capitalRes.ok) {
        setCapitalTxs(await capitalRes.json());
      }
    } catch (error) {
      setError("Failed to load dashboard data");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        await fetchData();
      } else {
        const data = await res.json();
        setError(data.error || "Sync failed");
      }
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleCapitalTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      const endpoint = txType === "contribution" ? "/api/capital/contribute" : "/api/capital/redeem";
      const body = txType === "contribution"
        ? { investorId: selectedInvestor, amount: parseFloat(txAmount), description: txDescription || undefined }
        : { investorId: selectedInvestor, shares: parseFloat(txShares), description: txDescription || undefined };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.ok) {
        const investor = portfolio?.investors.find(i => i.id === selectedInvestor);
        if (txType === "contribution") {
          setSuccessMessage(`Contribution of ${formatCurrency(parseFloat(txAmount))} processed for ${investor?.name}. Issued ${data.shareTransaction.shares.toFixed(2)} shares at NAV $${data.shareTransaction.navAtTransaction.toFixed(4)}`);
        } else {
          setSuccessMessage(`Redemption of ${parseFloat(txShares).toFixed(2)} shares processed for ${investor?.name}. Paid out ${formatCurrency(data.shareTransaction.redemptionAmount)}`);
        }
        // Reset form
        setTxAmount("");
        setTxShares("");
        setTxDescription("");
        // Refresh data
        await fetchData();
      } else {
        setError(data.error || "Transaction failed");
      }
    } catch {
      setError("Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="bg-background border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">CUAN Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Welcome, {session.user?.name} {session.user?.isFounder && <Badge variant="secondary">Founder</Badge>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {portfolio?.binanceConfigured && (
              <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                Sync
              </Button>
            )}
            <Link href="/settings">
              <Button variant="ghost" size="sm">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}

        {!portfolio?.binanceConfigured && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
            <AlertCircle className="h-5 w-5" />
            Binance API not configured. Add your API keys to .env to enable live data.
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="capital">Capital</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Portfolio</CardTitle>
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(portfolio?.portfolio.totalValue ?? 18)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Initial: {formatCurrency(portfolio?.portfolio.initialCapital ?? 18)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">NAV per Share</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    ${(portfolio?.nav ?? 1).toFixed(4)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(portfolio?.totalShares ?? 18, 2)} total shares
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total P&L</CardTitle>
                  {(portfolio?.portfolio.totalPnl ?? 0) >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${(portfolio?.portfolio.totalPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatCurrency(portfolio?.portfolio.totalPnl ?? 0)}
                  </div>
                  <p className={`text-xs ${(portfolio?.portfolio.totalPnlPercent ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatPercent(portfolio?.portfolio.totalPnlPercent ?? 0)}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatNumber(portfolio?.stats.winRate ?? 0, 1)}%
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {portfolio?.stats.wins ?? 0}W / {portfolio?.stats.losses ?? 0}L
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {navHistory && navHistory.history.length > 0 ? (
                <NavChart data={navHistory.history} statistics={navHistory.statistics} />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>NAV History</CardTitle>
                    <CardDescription>Not enough data yet</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
                    NAV history will appear after snapshots are recorded
                  </CardContent>
                </Card>
              )}

              {portfolio?.investors && portfolio.investors.length > 0 && (
                <InvestorPieChart
                  investors={portfolio.investors}
                  totalShares={portfolio.totalShares}
                />
              )}
            </div>

            {/* Investor Holdings */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Investor Holdings
                </CardTitle>
                <CardDescription>
                  Current share holdings and values
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {portfolio?.investors.map((investor) => (
                    <Card key={investor.id} className="bg-muted/50">
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h3 className="font-semibold text-lg">{investor.name}</h3>
                            <p className="text-sm text-muted-foreground">
                              {formatNumber(investor.shares, 2)} shares
                            </p>
                          </div>
                          <Badge variant={investor.pnl >= 0 ? "default" : "destructive"}>
                            {formatPercent(investor.pnlPercent)}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Cost Basis:</span>
                            <span>{formatCurrency(investor.costBasis)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Current Value:</span>
                            <span className="font-semibold">{formatCurrency(investor.value)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">P&L:</span>
                            <span className={investor.pnl >= 0 ? "text-green-500" : "text-red-500"}>
                              {formatCurrency(investor.pnl)}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Open Positions */}
            {portfolio?.positions && portfolio.positions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Open Positions</CardTitle>
                  <CardDescription>Current active positions</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead>Mark</TableHead>
                        <TableHead>Leverage</TableHead>
                        <TableHead className="text-right">Unrealized P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolio.positions.map((position, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{position.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={position.side === "LONG" ? "default" : "destructive"}>
                              {position.side}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatNumber(position.quantity, 4)}</TableCell>
                          <TableCell>{formatCurrency(position.entryPrice)}</TableCell>
                          <TableCell>{formatCurrency(position.markPrice)}</TableCell>
                          <TableCell>{position.leverage}x</TableCell>
                          <TableCell className={`text-right font-semibold ${position.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {formatCurrency(position.unrealizedPnl)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Trades Tab */}
          <TabsContent value="trades">
            <Card>
              <CardHeader>
                <CardTitle>Trade History</CardTitle>
                <CardDescription>Recent closed trades</CardDescription>
              </CardHeader>
              <CardContent>
                {trades?.trades && trades.trades.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Entry</TableHead>
                        <TableHead>Exit</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trades.trades.map((trade) => (
                        <TableRow key={trade.id}>
                          <TableCell className="font-medium">{trade.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={trade.positionSide === "LONG" ? "default" : "destructive"}>
                              {trade.positionSide}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatCurrency(trade.entryPrice)}</TableCell>
                          <TableCell>{trade.exitPrice ? formatCurrency(trade.exitPrice) : "-"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{trade.status}</Badge>
                          </TableCell>
                          <TableCell>{new Date(trade.openedAt).toLocaleDateString()}</TableCell>
                          <TableCell className={`text-right font-semibold ${(trade.pnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {trade.pnl !== null ? formatCurrency(trade.pnl) : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No trades yet. Start trading to see your history here.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {navHistory && navHistory.history.length > 0 && (
                <PortfolioValueChart
                  data={navHistory.history}
                  currentValue={portfolio?.portfolio.totalValue}
                  initialCapital={portfolio?.portfolio.initialCapital}
                />
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Performance Metrics</CardTitle>
                  <CardDescription>Key statistics over the period</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">NAV Change</span>
                      <span className={`font-bold ${parseFloat(navHistory?.statistics.navChange ?? "0") >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {navHistory?.statistics.navChange ?? "0"}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Volatility (Annualized)</span>
                      <span className="font-bold">{navHistory?.statistics.volatility ?? "0"}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">High NAV</span>
                      <span className="font-bold">${(navHistory?.statistics.highNav ?? 1).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Low NAV</span>
                      <span className="font-bold">${(navHistory?.statistics.lowNav ?? 1).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Total Trades</span>
                      <span className="font-bold">{portfolio?.stats.totalTrades ?? 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Win Rate</span>
                      <span className="font-bold">{formatNumber(portfolio?.stats.winRate ?? 0, 1)}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Realized P&L</span>
                      <span className={`font-bold ${(portfolio?.stats.totalPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {formatCurrency(portfolio?.stats.totalPnl ?? 0)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Capital Tab */}
          <TabsContent value="capital">
            {/* Admin Panel - Only visible to admins */}
            {session?.user?.isAdmin && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Process Capital Transaction
                  </CardTitle>
                  <CardDescription>
                    Add contributions or process redemptions for investors
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {successMessage && (
                    <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-700 dark:text-green-400 text-sm">
                      {successMessage}
                    </div>
                  )}
                  <form onSubmit={handleCapitalTransaction} className="space-y-4">
                    {/* Transaction Type Toggle */}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={txType === "contribution" ? "default" : "outline"}
                        onClick={() => setTxType("contribution")}
                        className="flex-1"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Contribution
                      </Button>
                      <Button
                        type="button"
                        variant={txType === "redemption" ? "default" : "outline"}
                        onClick={() => setTxType("redemption")}
                        className="flex-1"
                      >
                        <Minus className="h-4 w-4 mr-2" />
                        Redemption
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Investor Select */}
                      <div className="space-y-2">
                        <Label htmlFor="investor">Investor</Label>
                        <select
                          id="investor"
                          value={selectedInvestor}
                          onChange={(e) => setSelectedInvestor(e.target.value)}
                          required
                          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                          <option value="">Select investor...</option>
                          {portfolio?.investors.map((investor) => (
                            <option key={investor.id} value={investor.id}>
                              {investor.name} ({investor.shares.toFixed(2)} shares)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Amount or Shares */}
                      {txType === "contribution" ? (
                        <div className="space-y-2">
                          <Label htmlFor="amount">Amount (USDT)</Label>
                          <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="100.00"
                            value={txAmount}
                            onChange={(e) => setTxAmount(e.target.value)}
                            required
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label htmlFor="shares">Shares to Redeem</Label>
                          <Input
                            id="shares"
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={portfolio?.investors.find(i => i.id === selectedInvestor)?.shares || 0}
                            placeholder="1.00"
                            value={txShares}
                            onChange={(e) => setTxShares(e.target.value)}
                            required
                          />
                          {selectedInvestor && (
                            <p className="text-xs text-muted-foreground">
                              Max: {portfolio?.investors.find(i => i.id === selectedInvestor)?.shares.toFixed(2)} shares
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                      <Label htmlFor="description">Description (optional)</Label>
                      <Input
                        id="description"
                        placeholder="e.g., Monthly contribution"
                        value={txDescription}
                        onChange={(e) => setTxDescription(e.target.value)}
                      />
                    </div>

                    {/* Preview */}
                    {selectedInvestor && (txAmount || txShares) && (
                      <div className="p-3 bg-muted rounded-lg text-sm">
                        <p className="font-medium mb-1">Preview:</p>
                        {txType === "contribution" && txAmount && (
                          <p>
                            {portfolio?.investors.find(i => i.id === selectedInvestor)?.name} will receive{" "}
                            <span className="font-bold">
                              {(parseFloat(txAmount) / (portfolio?.nav || 1)).toFixed(2)} shares
                            </span>{" "}
                            at current NAV of ${portfolio?.nav.toFixed(4)}
                          </p>
                        )}
                        {txType === "redemption" && txShares && (
                          <p>
                            {portfolio?.investors.find(i => i.id === selectedInvestor)?.name} will receive{" "}
                            <span className="font-bold">
                              {formatCurrency(parseFloat(txShares) * (portfolio?.nav || 1))}
                            </span>{" "}
                            for {txShares} shares at current NAV of ${portfolio?.nav.toFixed(4)}
                          </p>
                        )}
                      </div>
                    )}

                    <Button type="submit" disabled={submitting} className="w-full">
                      {submitting ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          {txType === "contribution" ? <Plus className="h-4 w-4 mr-2" /> : <Minus className="h-4 w-4 mr-2" />}
                          Process {txType === "contribution" ? "Contribution" : "Redemption"}
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Share Transactions</CardTitle>
                  <CardDescription>History of share issuance and redemptions</CardDescription>
                </CardHeader>
                <CardContent>
                  {capitalTxs?.shareTransactions && capitalTxs.shareTransactions.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Investor</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Shares</TableHead>
                          <TableHead>NAV</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {capitalTxs.shareTransactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell>{new Date(tx.timestamp).toLocaleDateString()}</TableCell>
                            <TableCell>{tx.investor?.name ?? "Unknown"}</TableCell>
                            <TableCell>
                              <Badge variant={tx.type === "BUY" || tx.type === "INITIAL" ? "default" : "destructive"}>
                                {tx.type}
                              </Badge>
                            </TableCell>
                            <TableCell>{formatNumber(Math.abs(tx.shares), 2)}</TableCell>
                            <TableCell>${tx.navAtTransaction.toFixed(4)}</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(Math.abs(tx.amount))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No share transactions yet.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Capital Transactions</CardTitle>
                  <CardDescription>Contributions and redemptions</CardDescription>
                </CardHeader>
                <CardContent>
                  {capitalTxs?.transactions && capitalTxs.transactions.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Investor</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {capitalTxs.transactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell>{new Date(tx.timestamp).toLocaleDateString()}</TableCell>
                            <TableCell>
                              <Badge variant={tx.type === "CONTRIBUTION" ? "default" : "destructive"}>
                                {tx.type}
                              </Badge>
                            </TableCell>
                            <TableCell>{tx.investor?.name ?? "Fund"}</TableCell>
                            <TableCell className={`text-right font-medium ${tx.amount >= 0 ? "text-green-500" : "text-red-500"}`}>
                              {formatCurrency(Math.abs(tx.amount))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No capital transactions yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          Last updated: {portfolio?.lastUpdated ? new Date(portfolio.lastUpdated).toLocaleString() : "Never"}
        </div>
      </main>
    </div>
  );
}
