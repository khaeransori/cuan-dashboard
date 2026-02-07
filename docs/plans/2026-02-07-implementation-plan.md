# CUAN Dashboard Enhancement - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the CUAN dashboard with share-based NAV accounting, performance visualization, trade analytics, and capital management.

**Architecture:** Migrate from SQLite to Supabase (PostgreSQL), add NAV-based share tracking, implement Recharts visualizations, restructure UI to tab-based layout. All calculations server-side via API routes.

**Tech Stack:** Next.js 14, Prisma + Supabase, NextAuth, Tailwind + shadcn/ui, Recharts

---

## Phase 1: Database Migration & NAV Foundation

### Task 1.1: Set Up Supabase Project

**Files:**
- Modify: `.env`
- Modify: `.env.example`

**Step 1: Create Supabase project**

Go to https://supabase.com and create a new project called "cuan-dashboard".

**Step 2: Get connection strings**

From Supabase Dashboard > Settings > Database, copy:
- Connection string (Transaction pooler for Prisma)
- Direct connection (for migrations)

**Step 3: Update environment files**

`.env`:
```env
# Database - Supabase
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"

# Keep existing
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key"
BINANCE_API_KEY=""
BINANCE_API_SECRET=""
```

`.env.example`:
```env
# Database - Supabase
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"

NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-change-in-production"
BINANCE_API_KEY=""
BINANCE_API_SECRET=""
```

**Step 4: Commit**

```bash
git add .env.example
git commit -m "chore: add Supabase connection string template"
```

> Note: Never commit `.env` - it's in `.gitignore`

---

### Task 1.2: Update Prisma Schema for PostgreSQL + NAV

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Replace entire schema**

```prisma
// CUAN Dashboard - Database Schema
// PostgreSQL + Prisma (Supabase)

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─────────────────────────────────────────────
// Investors (renamed from Founder)
// ─────────────────────────────────────────────
model Investor {
  id        String   @id @default(cuid())
  username  String   @unique
  password  String
  name      String
  email     String?
  isAdmin   Boolean  @default(false)
  isFounder Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  shareTransactions ShareTransaction[]
  transactions      Transaction[]
}

// ─────────────────────────────────────────────
// Share Ledger (tracks ownership changes)
// ─────────────────────────────────────────────
model ShareTransaction {
  id               String   @id @default(cuid())
  investorId       String
  investor         Investor @relation(fields: [investorId], references: [id])
  type             String   // BUY, SELL, INITIAL
  shares           Float
  navAtTransaction Float
  amount           Float
  timestamp        DateTime @default(now())

  @@index([investorId])
  @@index([timestamp])
}

// ─────────────────────────────────────────────
// Trade History (synced from Binance)
// ─────────────────────────────────────────────
model Trade {
  id           String    @id @default(cuid())
  binanceId    String    @unique
  symbol       String
  side         String
  positionSide String
  entryPrice   Float
  exitPrice    Float?
  quantity     Float
  leverage     Int       @default(1)
  margin       Float?
  pnl          Float?
  pnlPercent   Float?
  commission   Float     @default(0)
  status       String    @default("OPEN")
  openedAt     DateTime
  closedAt     DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  // Analytics fields
  strategy  String?
  setup     String?
  notes     String?
  rating    Int?

  @@index([symbol])
  @@index([status])
  @@index([strategy])
  @@index([openedAt])
}

// ─────────────────────────────────────────────
// Portfolio Snapshots (for charts + NAV)
// ─────────────────────────────────────────────
model Snapshot {
  id            String   @id @default(cuid())
  totalValue    Float
  totalShares   Float    @default(18)
  nav           Float    @default(1)
  availableUsdt Float
  unrealizedPnl Float    @default(0)
  marginUsed    Float    @default(0)
  btcPrice      Float?
  trigger       String   @default("daily")
  timestamp     DateTime @default(now())

  @@index([timestamp])
}

// ─────────────────────────────────────────────
// Capital Transactions
// ─────────────────────────────────────────────
model Transaction {
  id          String    @id @default(cuid())
  type        String
  amount      Float
  currency    String    @default("USDT")
  investorId  String?
  investor    Investor? @relation(fields: [investorId], references: [id])
  description String?
  txHash      String?
  timestamp   DateTime  @default(now())

  @@index([investorId])
  @@index([type])
}

// ─────────────────────────────────────────────
// Strategy Reference
// ─────────────────────────────────────────────
model Strategy {
  id          String  @id @default(cuid())
  name        String  @unique
  description String?
  isBot       Boolean @default(false)
  isActive    Boolean @default(true)
}

// ─────────────────────────────────────────────
// System Settings
// ─────────────────────────────────────────────
model Setting {
  id        String   @id @default(cuid())
  key       String   @unique
  value     String
  updatedAt DateTime @updatedAt
}
```

**Step 2: Commit schema changes**

```bash
git add prisma/schema.prisma
git commit -m "feat: update schema for PostgreSQL + NAV system

- Rename Founder to Investor
- Add ShareTransaction for share ledger
- Add NAV fields to Snapshot
- Add analytics fields to Trade (strategy, setup, notes, rating)
- Add Strategy reference table
- Add indexes for query performance"
```

---

### Task 1.3: Update Seed Script for NAV

**Files:**
- Modify: `prisma/seed.ts`

**Step 1: Replace seed script**

```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Hash passwords
  const aanPassword = await bcrypt.hash("KGo1Fq7tgV", 10);
  const dhanuPassword = await bcrypt.hash("CwGdljM57x", 10);
  const gladysPassword = await bcrypt.hash("3lbKVzX4C8", 10);

  // Initial NAV and shares
  const INITIAL_NAV = 1.0;
  const SHARES_PER_FOUNDER = 6;
  const INITIAL_CAPITAL = 18.0;

  // Create/update investors
  const investorsData = [
    {
      username: "aan",
      password: aanPassword,
      name: "Aan",
      isAdmin: true,
      isFounder: true,
    },
    {
      username: "dhanu",
      password: dhanuPassword,
      name: "Dhanu",
      isAdmin: false,
      isFounder: true,
    },
    {
      username: "gladys",
      password: gladysPassword,
      name: "Gladys",
      isAdmin: false,
      isFounder: true,
    },
  ];

  const investors = [];
  for (const data of investorsData) {
    const investor = await prisma.investor.upsert({
      where: { username: data.username },
      update: data,
      create: data,
    });
    investors.push(investor);
    console.log(`Upserted investor: ${investor.name}`);
  }

  // Create initial share transactions (if not exist)
  for (const investor of investors) {
    const existingShare = await prisma.shareTransaction.findFirst({
      where: {
        investorId: investor.id,
        type: "INITIAL",
      },
    });

    if (!existingShare) {
      await prisma.shareTransaction.create({
        data: {
          investorId: investor.id,
          type: "INITIAL",
          shares: SHARES_PER_FOUNDER,
          navAtTransaction: INITIAL_NAV,
          amount: SHARES_PER_FOUNDER * INITIAL_NAV,
        },
      });
      console.log(`Created initial shares for: ${investor.name}`);
    }
  }

  // Create initial snapshot with NAV
  const existingSnapshot = await prisma.snapshot.findFirst({
    orderBy: { timestamp: "asc" },
  });

  if (!existingSnapshot) {
    await prisma.snapshot.create({
      data: {
        totalValue: INITIAL_CAPITAL,
        totalShares: SHARES_PER_FOUNDER * 3,
        nav: INITIAL_NAV,
        availableUsdt: INITIAL_CAPITAL,
        unrealizedPnl: 0,
        marginUsed: 0,
        trigger: "initial",
      },
    });
    console.log("Created initial snapshot");
  }

  // Create default strategies
  const strategies = [
    { name: "BB_BOUNCE", description: "Bollinger Band bounce strategy", isBot: true },
    { name: "MANUAL", description: "Manual trades", isBot: false },
    { name: "SCALP", description: "Scalping strategy", isBot: false },
    { name: "TREND", description: "Trend following", isBot: false },
    { name: "BREAKOUT", description: "Breakout strategy", isBot: false },
  ];

  for (const strategy of strategies) {
    await prisma.strategy.upsert({
      where: { name: strategy.name },
      update: strategy,
      create: strategy,
    });
    console.log(`Upserted strategy: ${strategy.name}`);
  }

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

**Step 2: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: update seed script for NAV system

- Create Investor records (renamed from Founder)
- Create initial ShareTransaction (6 shares each at NAV $1.00)
- Create initial Snapshot with NAV
- Seed default strategies"
```

---

### Task 1.4: Run Database Migration

**Step 1: Generate and apply migration**

```bash
cd cuan-dashboard
npx prisma migrate dev --name init_postgresql_nav
```

Expected output:
```
Applying migration `YYYYMMDDHHMMSS_init_postgresql_nav`
Migration applied successfully.
```

**Step 2: Run seed**

```bash
npm run db:seed
```

Expected output:
```
Seeding database...
Upserted investor: Aan
Upserted investor: Dhanu
Upserted investor: Gladys
Created initial shares for: Aan
Created initial shares for: Dhanu
Created initial shares for: Gladys
Created initial snapshot
Upserted strategy: BB_BOUNCE
...
Database seeded successfully!
```

**Step 3: Verify with Prisma Studio**

```bash
npx prisma studio
```

Check that:
- 3 Investor records exist
- 3 ShareTransaction records (type: INITIAL, 6 shares each)
- 1 Snapshot with nav: 1.0
- 5 Strategy records

**Step 4: Commit migration**

```bash
git add prisma/migrations
git commit -m "chore: add PostgreSQL migration"
```

---

### Task 1.5: Add NAV Calculation Helpers

**Files:**
- Create: `lib/nav.ts`

**Step 1: Create NAV helper module**

```typescript
import prisma from "@/lib/db";

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
 * Calculate current NAV from latest snapshot or live data
 */
export async function getCurrentNav(): Promise<NavData> {
  const latestSnapshot = await prisma.snapshot.findFirst({
    orderBy: { timestamp: "desc" },
  });

  if (!latestSnapshot) {
    // Default: initial state
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
 * Calculate total shares for an investor from their transactions
 */
export async function getInvestorShares(investorId: string): Promise<number> {
  const transactions = await prisma.shareTransaction.findMany({
    where: { investorId },
  });

  return transactions.reduce((total, tx) => total + tx.shares, 0);
}

/**
 * Get all investors with their share holdings and values
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
 * Calculate shares to issue for a contribution
 */
export function calculateSharesForContribution(
  amount: number,
  currentNav: number
): number {
  return amount / currentNav;
}

/**
 * Calculate amount for redeeming shares
 */
export function calculateAmountForRedemption(
  shares: number,
  currentNav: number
): number {
  return shares * currentNav;
}

/**
 * Create a new snapshot with NAV
 */
export async function createSnapshot(
  totalValue: number,
  availableUsdt: number,
  unrealizedPnl: number,
  marginUsed: number,
  trigger: "daily" | "contribution" | "redemption" | "manual" | "sync",
  btcPrice?: number
): Promise<void> {
  // Get current total shares
  const allShares = await prisma.shareTransaction.findMany();
  const totalShares = allShares.reduce((sum, tx) => sum + tx.shares, 0);

  const nav = totalShares > 0 ? totalValue / totalShares : 1.0;

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
    },
  });
}
```

**Step 2: Commit**

```bash
git add lib/nav.ts
git commit -m "feat: add NAV calculation helpers

- getCurrentNav: get latest NAV from snapshot
- getInvestorShares: calculate shares for one investor
- getAllInvestorShares: get all investors with values
- calculateSharesForContribution: shares for new investment
- calculateAmountForRedemption: value for share redemption
- createSnapshot: record snapshot with NAV"
```

---

### Task 1.6: Update Portfolio API for NAV

**Files:**
- Modify: `app/api/portfolio/route.ts`

**Step 1: Update portfolio API**

```typescript
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { getAccountInfo, getPositions, getTradeHistory, isConfigured } from "@/lib/binance";
import { getCurrentNav, getAllInvestorShares, createSnapshot } from "@/lib/nav";

interface BinanceTrade {
  realizedPnl: string;
}

interface BinancePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  leverage: string;
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
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

    // Try to get live data from Binance if configured
    let liveData = null;
    let positions: BinancePosition[] = [];
    let tradeStats = { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, winRate: 0 };

    if (isConfigured()) {
      try {
        liveData = await getAccountInfo();
        positions = await getPositions();

        // Fetch trade history from Binance for stats
        const rawTrades: BinanceTrade[] = await getTradeHistory(undefined, 100);

        // Calculate stats from Binance trades
        const pnlTrades = rawTrades.filter((t) => parseFloat(t.realizedPnl) !== 0);
        const wins = pnlTrades.filter((t) => parseFloat(t.realizedPnl) > 0);
        const losses = pnlTrades.filter((t) => parseFloat(t.realizedPnl) < 0);
        const totalPnl = pnlTrades.reduce((sum, t) => sum + parseFloat(t.realizedPnl), 0);

        tradeStats = {
          totalTrades: pnlTrades.length,
          wins: wins.length,
          losses: losses.length,
          totalPnl: totalPnl,
          winRate: pnlTrades.length > 0 ? (wins.length / pnlTrades.length) * 100 : 0,
        };

        // Update NAV with live data if available
        if (liveData) {
          const totalValue = parseFloat(liveData.totalWalletBalance);
          const unrealizedPnl = parseFloat(liveData.totalUnrealizedProfit);
          const availableBalance = parseFloat(liveData.availableBalance);
          const marginUsed = parseFloat(liveData.totalPositionInitialMargin);

          // Recalculate with live data
          navData.totalValue = totalValue;
          navData.nav = navData.totalShares > 0 ? totalValue / navData.totalShares : 1.0;

          // Update investor values with live NAV
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
    const totalValue = liveData?.totalWalletBalance
      ? parseFloat(liveData.totalWalletBalance)
      : latestSnapshot?.totalValue ?? 18;
    const unrealizedPnl = liveData?.totalUnrealizedProfit
      ? parseFloat(liveData.totalUnrealizedProfit)
      : latestSnapshot?.unrealizedPnl ?? 0;
    const availableBalance = liveData?.availableBalance
      ? parseFloat(liveData.availableBalance)
      : latestSnapshot?.availableUsdt ?? totalValue;

    // Initial contribution (sum of all investors' cost basis)
    const initialCapital = investorShares.reduce((sum, inv) => sum + inv.costBasis, 0);
    const totalPnlFromStart = totalValue - initialCapital;
    const totalPnlPercent = initialCapital > 0 ? (totalPnlFromStart / initialCapital) * 100 : 0;

    return NextResponse.json({
      portfolio: {
        totalValue,
        initialCapital,
        unrealizedPnl,
        availableBalance,
        marginUsed: liveData?.totalPositionInitialMargin
          ? parseFloat(liveData.totalPositionInitialMargin)
          : latestSnapshot?.marginUsed ?? 0,
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
```

**Step 2: Commit**

```bash
git add app/api/portfolio/route.ts
git commit -m "feat: update portfolio API for NAV system

- Use NAV helpers instead of fixed percentages
- Return nav, totalShares in response
- Replace founders with investors array
- Include shares, value, costBasis, pnl per investor
- Calculate values from share transactions"
```

---

### Task 1.7: Update Auth for Investor Model

**Files:**
- Modify: `lib/auth.ts`
- Modify: `types/next-auth.d.ts`

**Step 1: Read current auth.ts**

First, read the current file to understand the structure.

**Step 2: Update auth.ts**

```typescript
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "@/lib/db";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const investor = await prisma.investor.findUnique({
          where: { username: credentials.username },
        });

        if (!investor) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          investor.password
        );

        if (!isValid) {
          return null;
        }

        return {
          id: investor.id,
          name: investor.name,
          username: investor.username,
          isAdmin: investor.isAdmin,
          isFounder: investor.isFounder,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.isAdmin = user.isAdmin;
        token.isFounder = user.isFounder;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.isAdmin = token.isAdmin as boolean;
        session.user.isFounder = token.isFounder as boolean;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
```

**Step 3: Update types/next-auth.d.ts**

```typescript
import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    username: string;
    isAdmin: boolean;
    isFounder: boolean;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      username: string;
      isAdmin: boolean;
      isFounder: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    isAdmin: boolean;
    isFounder: boolean;
  }
}
```

**Step 4: Commit**

```bash
git add lib/auth.ts types/next-auth.d.ts
git commit -m "feat: update auth for Investor model

- Query Investor instead of Founder
- Add isFounder to session for future LP distinction"
```

---

### Task 1.8: Verify Phase 1 Works

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Test login**

Go to http://localhost:3000/login and login with:
- Username: aan
- Password: KGo1Fq7tgV

**Step 3: Verify dashboard loads**

Check that:
- Dashboard loads without errors
- Portfolio cards show values
- Investor shares section displays (instead of "Founder Shares")

**Step 4: Check API response**

```bash
curl http://localhost:3000/api/portfolio -H "Cookie: [session-cookie]"
```

Verify response includes:
- `nav`: number
- `totalShares`: number
- `investors`: array with shares, value, costBasis, pnl

**Step 5: Commit any fixes if needed**

---

## Phase 2: Capital Management

### Task 2.1: Create Capital Contribution API

**Files:**
- Create: `app/api/capital/contribute/route.ts`

**Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import { getCurrentNav, calculateSharesForContribution, createSnapshot } from "@/lib/nav";
import { getAccountInfo, isConfigured } from "@/lib/binance";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { investorId, amount } = body;

    if (!investorId || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "Invalid investorId or amount" },
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
    await prisma.transaction.create({
      data: {
        type: "CONTRIBUTION",
        amount,
        currency: "USDT",
        investorId,
        description: `Contribution of $${amount} at NAV $${navData.nav.toFixed(4)}`,
      },
    });

    // Create snapshot to record the contribution
    // Get live data if available, otherwise use latest snapshot values
    let totalValue = navData.totalValue + amount;
    let availableUsdt = totalValue;
    let unrealizedPnl = 0;
    let marginUsed = 0;

    if (isConfigured()) {
      try {
        const liveData = await getAccountInfo();
        if (liveData) {
          // Note: The actual deposit needs to happen on Binance separately
          // This just records the accounting
          totalValue = parseFloat(liveData.totalWalletBalance) + amount;
          availableUsdt = parseFloat(liveData.availableBalance) + amount;
          unrealizedPnl = parseFloat(liveData.totalUnrealizedProfit);
          marginUsed = parseFloat(liveData.totalPositionInitialMargin);
        }
      } catch (error) {
        console.error("Failed to get Binance data:", error);
      }
    }

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
        nav: navData.nav,
        amount,
      },
      message: `Issued ${sharesToIssue.toFixed(4)} shares to ${investor.name} at NAV $${navData.nav.toFixed(4)}`,
    });
  } catch (error) {
    console.error("Contribution error:", error);
    return NextResponse.json(
      { error: "Failed to process contribution" },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add app/api/capital/contribute/route.ts
git commit -m "feat: add capital contribution API

- POST /api/capital/contribute
- Calculate shares at current NAV
- Create ShareTransaction and Transaction records
- Create snapshot on contribution
- Admin only"
```

---

### Task 2.2: Create Capital Redemption API

**Files:**
- Create: `app/api/capital/redeem/route.ts`

**Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";
import {
  getCurrentNav,
  getInvestorShares,
  calculateAmountForRedemption,
  createSnapshot
} from "@/lib/nav";
import { getAccountInfo, isConfigured } from "@/lib/binance";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { investorId, shares, amount } = body;

    if (!investorId || (!shares && !amount)) {
      return NextResponse.json(
        { error: "Invalid request: need investorId and either shares or amount" },
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

    // Get current NAV and investor's shares
    const navData = await getCurrentNav();
    const currentShares = await getInvestorShares(investorId);

    // Calculate shares to redeem
    let sharesToRedeem: number;
    let redemptionAmount: number;

    if (shares) {
      sharesToRedeem = shares;
      redemptionAmount = calculateAmountForRedemption(shares, navData.nav);
    } else {
      sharesToRedeem = amount / navData.nav;
      redemptionAmount = amount;
    }

    // Validate investor has enough shares
    if (sharesToRedeem > currentShares) {
      return NextResponse.json(
        { error: `Insufficient shares. Investor has ${currentShares.toFixed(4)} shares.` },
        { status: 400 }
      );
    }

    // Create share transaction (negative shares = redemption)
    const shareTransaction = await prisma.shareTransaction.create({
      data: {
        investorId,
        type: "SELL",
        shares: -sharesToRedeem,
        navAtTransaction: navData.nav,
        amount: redemptionAmount,
      },
    });

    // Create capital transaction record
    await prisma.transaction.create({
      data: {
        type: "REDEMPTION",
        amount: redemptionAmount,
        currency: "USDT",
        investorId,
        description: `Redemption of ${sharesToRedeem.toFixed(4)} shares at NAV $${navData.nav.toFixed(4)}`,
      },
    });

    // Create snapshot to record the redemption
    let totalValue = navData.totalValue - redemptionAmount;
    let availableUsdt = totalValue;
    let unrealizedPnl = 0;
    let marginUsed = 0;

    if (isConfigured()) {
      try {
        const liveData = await getAccountInfo();
        if (liveData) {
          totalValue = parseFloat(liveData.totalWalletBalance) - redemptionAmount;
          availableUsdt = parseFloat(liveData.availableBalance) - redemptionAmount;
          unrealizedPnl = parseFloat(liveData.totalUnrealizedProfit);
          marginUsed = parseFloat(liveData.totalPositionInitialMargin);
        }
      } catch (error) {
        console.error("Failed to get Binance data:", error);
      }
    }

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
        shares: sharesToRedeem,
        nav: navData.nav,
        amount: redemptionAmount,
      },
      message: `Redeemed ${sharesToRedeem.toFixed(4)} shares from ${investor.name} for $${redemptionAmount.toFixed(2)}`,
    });
  } catch (error) {
    console.error("Redemption error:", error);
    return NextResponse.json(
      { error: "Failed to process redemption" },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add app/api/capital/redeem/route.ts
git commit -m "feat: add capital redemption API

- POST /api/capital/redeem
- Accept shares OR amount
- Validate sufficient shares
- Create negative ShareTransaction
- Create snapshot on redemption
- Admin only"
```

---

### Task 2.3: Create Capital Transactions API

**Files:**
- Create: `app/api/capital/transactions/route.ts`

**Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const investorId = searchParams.get("investorId");

    // Build where clause
    const where: { investorId?: string } = {};

    // Non-admins can only see their own transactions
    if (!session.user.isAdmin) {
      where.investorId = session.user.id;
    } else if (investorId) {
      where.investorId = investorId;
    }

    // Get share transactions
    const shareTransactions = await prisma.shareTransaction.findMany({
      where,
      include: {
        investor: {
          select: { name: true },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    // Get capital transactions
    const capitalTransactions = await prisma.transaction.findMany({
      where: {
        ...where,
        type: { in: ["CONTRIBUTION", "REDEMPTION", "DISTRIBUTION"] },
      },
      include: {
        investor: {
          select: { name: true },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    return NextResponse.json({
      shareTransactions: shareTransactions.map((tx) => ({
        id: tx.id,
        investorId: tx.investorId,
        investorName: tx.investor.name,
        type: tx.type,
        shares: tx.shares,
        nav: tx.navAtTransaction,
        amount: tx.amount,
        timestamp: tx.timestamp,
      })),
      capitalTransactions: capitalTransactions.map((tx) => ({
        id: tx.id,
        investorId: tx.investorId,
        investorName: tx.investor?.name ?? "Unknown",
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        description: tx.description,
        timestamp: tx.timestamp,
      })),
    });
  } catch (error) {
    console.error("Capital transactions error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add app/api/capital/transactions/route.ts
git commit -m "feat: add capital transactions API

- GET /api/capital/transactions
- Filter by investorId (optional)
- Non-admins see only their own
- Returns both share and capital transactions"
```

---

### Task 2.4: Create NAV History API

**Files:**
- Create: `app/api/nav/history/route.ts`
- Create: `app/api/nav/current/route.ts`

**Step 1: Create NAV history route**

```typescript
// app/api/nav/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // Build date filter
    const where: { timestamp?: { gte?: Date; lte?: Date } } = {};

    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to) where.timestamp.lte = new Date(to);
    }

    const snapshots = await prisma.snapshot.findMany({
      where,
      select: {
        timestamp: true,
        totalValue: true,
        totalShares: true,
        nav: true,
        unrealizedPnl: true,
        trigger: true,
      },
      orderBy: { timestamp: "asc" },
    });

    // Calculate derived metrics
    const history = snapshots.map((snapshot, index) => {
      const prevSnapshot = index > 0 ? snapshots[index - 1] : null;
      const navChange = prevSnapshot
        ? ((snapshot.nav - prevSnapshot.nav) / prevSnapshot.nav) * 100
        : 0;

      return {
        timestamp: snapshot.timestamp,
        totalValue: snapshot.totalValue,
        totalShares: snapshot.totalShares,
        nav: snapshot.nav,
        unrealizedPnl: snapshot.unrealizedPnl,
        navChange,
        trigger: snapshot.trigger,
      };
    });

    return NextResponse.json({
      history,
      summary: {
        startNav: snapshots[0]?.nav ?? 1,
        endNav: snapshots[snapshots.length - 1]?.nav ?? 1,
        totalReturn: snapshots.length > 0
          ? ((snapshots[snapshots.length - 1].nav - snapshots[0].nav) / snapshots[0].nav) * 100
          : 0,
        dataPoints: snapshots.length,
      },
    });
  } catch (error) {
    console.error("NAV history error:", error);
    return NextResponse.json(
      { error: "Failed to fetch NAV history" },
      { status: 500 }
    );
  }
}
```

**Step 2: Create NAV current route**

```typescript
// app/api/nav/current/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentNav, getAllInvestorShares } from "@/lib/nav";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const navData = await getCurrentNav();
    const investorShares = await getAllInvestorShares();

    return NextResponse.json({
      nav: navData.nav,
      totalValue: navData.totalValue,
      totalShares: navData.totalShares,
      timestamp: navData.timestamp,
      investors: investorShares,
    });
  } catch (error) {
    console.error("Current NAV error:", error);
    return NextResponse.json(
      { error: "Failed to fetch current NAV" },
      { status: 500 }
    );
  }
}
```

**Step 3: Commit**

```bash
git add app/api/nav/history/route.ts app/api/nav/current/route.ts
git commit -m "feat: add NAV APIs

- GET /api/nav/current - latest NAV with investor breakdown
- GET /api/nav/history - NAV history with date filters
- Include nav change % and summary stats"
```

---

## Phase 3: UI Components

### Task 3.1: Install Recharts and shadcn Tabs

**Step 1: Install dependencies**

```bash
cd cuan-dashboard
npm install recharts
npx shadcn@latest add tabs
```

**Step 2: Commit**

```bash
git add package.json package-lock.json components/ui/tabs.tsx
git commit -m "chore: add recharts and shadcn tabs"
```

---

### Task 3.2: Create Chart Components

**Files:**
- Create: `components/charts/equity-curve.tsx`
- Create: `components/charts/nav-chart.tsx`

**Step 1: Create equity curve component**

```typescript
// components/charts/equity-curve.tsx
"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DataPoint {
  timestamp: string;
  nav: number;
  totalValue: number;
}

interface EquityCurveProps {
  data: DataPoint[];
  title?: string;
  description?: string;
}

export function EquityCurve({
  data,
  title = "Equity Curve",
  description = "NAV over time"
}: EquityCurveProps) {
  const formattedData = data.map((point) => ({
    ...point,
    date: new Date(point.timestamp).toLocaleDateString(),
    navFormatted: point.nav.toFixed(4),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formattedData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                className="text-xs"
                tick={{ fill: 'currentColor' }}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                domain={['auto', 'auto']}
                tickFormatter={(value) => `$${value.toFixed(2)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: number) => [`$${value.toFixed(4)}`, 'NAV']}
              />
              <Line
                type="monotone"
                dataKey="nav"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Create NAV chart component**

```typescript
// components/charts/nav-chart.tsx
"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DataPoint {
  timestamp: string;
  totalValue: number;
  unrealizedPnl: number;
}

interface NavChartProps {
  data: DataPoint[];
}

export function NavChart({ data }: NavChartProps) {
  const formattedData = data.map((point) => ({
    ...point,
    date: new Date(point.timestamp).toLocaleDateString(),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Value</CardTitle>
        <CardDescription>Total value over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                className="text-xs"
                tick={{ fill: 'currentColor' }}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Value']}
              />
              <Area
                type="monotone"
                dataKey="totalValue"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 3: Commit**

```bash
git add components/charts/
git commit -m "feat: add chart components

- EquityCurve: NAV line chart over time
- NavChart: Portfolio value area chart"
```

---

### Task 3.3: Create Dashboard Tabs Structure

**Files:**
- Create: `components/dashboard/tabs.tsx`
- Create: `components/dashboard/overview-tab.tsx`
- Create: `components/dashboard/trades-tab.tsx`
- Create: `components/dashboard/analytics-tab.tsx`
- Create: `components/dashboard/capital-tab.tsx`

**Step 1: Create tabs wrapper**

```typescript
// components/dashboard/tabs.tsx
"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "./overview-tab";
import { TradesTab } from "./trades-tab";
import { AnalyticsTab } from "./analytics-tab";
import { CapitalTab } from "./capital-tab";

interface DashboardTabsProps {
  portfolioData: any;
  tradesData: any;
  navHistory: any;
}

export function DashboardTabs({ portfolioData, tradesData, navHistory }: DashboardTabsProps) {
  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList className="grid w-full grid-cols-4 lg:w-[400px]">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="trades">Trades</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="capital">Capital</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab
          portfolio={portfolioData.portfolio}
          investors={portfolioData.investors}
          positions={portfolioData.positions}
          stats={portfolioData.stats}
          nav={portfolioData.nav}
          navHistory={navHistory}
        />
      </TabsContent>

      <TabsContent value="trades">
        <TradesTab trades={tradesData.trades} pagination={tradesData.pagination} />
      </TabsContent>

      <TabsContent value="analytics">
        <AnalyticsTab
          stats={portfolioData.stats}
          navHistory={navHistory}
        />
      </TabsContent>

      <TabsContent value="capital">
        <CapitalTab
          investors={portfolioData.investors}
          nav={portfolioData.nav}
          totalShares={portfolioData.totalShares}
        />
      </TabsContent>
    </Tabs>
  );
}
```

**Step 2: Create overview tab**

```typescript
// components/dashboard/overview-tab.tsx
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Wallet, BarChart3, Users } from "lucide-react";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { EquityCurve } from "@/components/charts/equity-curve";

interface OverviewTabProps {
  portfolio: {
    totalValue: number;
    unrealizedPnl: number;
    availableBalance: number;
    marginUsed: number;
  };
  investors: Array<{
    id: string;
    name: string;
    shares: number;
    value: number;
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
  nav: number;
  navHistory: { history: Array<{ timestamp: string; nav: number; totalValue: number }> };
}

export function OverviewTab({ portfolio, investors, positions, stats, nav, navHistory }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Portfolio Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Portfolio</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(portfolio.totalValue)}</div>
            <p className="text-xs text-muted-foreground">
              NAV: ${nav.toFixed(4)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unrealized P&L</CardTitle>
            {portfolio.unrealizedPnl >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${portfolio.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              {formatCurrency(portfolio.unrealizedPnl)}
            </div>
            <p className="text-xs text-muted-foreground">
              Margin: {formatCurrency(portfolio.marginUsed)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats.winRate, 1)}%</div>
            <p className="text-xs text-muted-foreground">
              {stats.wins}W / {stats.losses}L
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Realized</CardTitle>
            {stats.totalPnl >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.totalPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
              {formatCurrency(stats.totalPnl)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.totalTrades} trades
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Equity Curve */}
      {navHistory.history.length > 1 && (
        <EquityCurve data={navHistory.history} />
      )}

      {/* Investor Shares */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Investor Shares
          </CardTitle>
          <CardDescription>Share ownership breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {investors.map((investor) => (
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
                      <span className="text-muted-foreground">Value:</span>
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
      {positions.length > 0 && (
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
                {positions.map((position, index) => (
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
    </div>
  );
}
```

**Step 3: Create placeholder tabs**

```typescript
// components/dashboard/trades-tab.tsx
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

interface TradesTabProps {
  trades: Array<{
    id: string;
    symbol: string;
    side: string;
    positionSide: string;
    entryPrice: number;
    exitPrice: number | null;
    status: string;
    pnl: number | null;
    openedAt: string;
    strategy?: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export function TradesTab({ trades, pagination }: TradesTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade History</CardTitle>
        <CardDescription>
          Showing {trades.length} of {pagination.total} trades
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trades.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
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
                    {trade.strategy ? (
                      <Badge variant="outline">{trade.strategy}</Badge>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={trade.status === "CLOSED" ? "secondary" : "default"}>
                      {trade.status}
                    </Badge>
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
            No trades yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

```typescript
// components/dashboard/analytics-tab.tsx
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NavChart } from "@/components/charts/nav-chart";

interface AnalyticsTabProps {
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
  };
  navHistory: {
    history: Array<{ timestamp: string; totalValue: number; unrealizedPnl: number }>;
    summary: { startNav: number; endNav: number; totalReturn: number };
  };
}

export function AnalyticsTab({ stats, navHistory }: AnalyticsTabProps) {
  const profitFactor = stats.losses > 0
    ? Math.abs(stats.totalPnl / stats.losses)
    : stats.totalPnl > 0 ? Infinity : 0;

  return (
    <div className="space-y-6">
      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Return</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${navHistory.summary.totalReturn >= 0 ? "text-green-500" : "text-red-500"}`}>
              {navHistory.summary.totalReturn.toFixed(2)}%
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.winRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">{stats.wins}W / {stats.losses}L</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Profit Factor</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTrades}</div>
          </CardContent>
        </Card>
      </div>

      {/* Portfolio Value Chart */}
      {navHistory.history.length > 1 && (
        <NavChart data={navHistory.history} />
      )}
    </div>
  );
}
```

```typescript
// components/dashboard/capital-tab.tsx
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface CapitalTabProps {
  investors: Array<{
    id: string;
    name: string;
    shares: number;
    value: number;
    costBasis: number;
    pnl: number;
    pnlPercent: number;
  }>;
  nav: number;
  totalShares: number;
}

export function CapitalTab({ investors, nav, totalShares }: CapitalTabProps) {
  const totalValue = investors.reduce((sum, inv) => sum + inv.value, 0);

  return (
    <div className="space-y-6">
      {/* NAV Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Current NAV</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${nav.toFixed(4)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Shares</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalShares, 2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total AUM</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Investor Holdings */}
      <Card>
        <CardHeader>
          <CardTitle>Investor Holdings</CardTitle>
          <CardDescription>Current share ownership and values</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Investor</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Ownership %</TableHead>
                <TableHead className="text-right">Cost Basis</TableHead>
                <TableHead className="text-right">Current Value</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="text-right">Return %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {investors.map((investor) => (
                <TableRow key={investor.id}>
                  <TableCell className="font-medium">{investor.name}</TableCell>
                  <TableCell className="text-right">{formatNumber(investor.shares, 4)}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber((investor.shares / totalShares) * 100, 2)}%
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(investor.costBasis)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(investor.value)}</TableCell>
                  <TableCell className={`text-right ${investor.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatCurrency(investor.pnl)}
                  </TableCell>
                  <TableCell className={`text-right ${investor.pnlPercent >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatNumber(investor.pnlPercent, 2)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add components/dashboard/
git commit -m "feat: add dashboard tab components

- DashboardTabs: main tabs wrapper
- OverviewTab: portfolio cards, equity curve, positions
- TradesTab: trade history with strategy column
- AnalyticsTab: performance metrics and charts
- CapitalTab: investor holdings and NAV info"
```

---

### Task 3.4: Update Dashboard Page

**Files:**
- Modify: `app/dashboard/page.tsx`

**Step 1: Rewrite dashboard page**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DashboardTabs } from "@/components/dashboard/tabs";
import { RefreshCw, LogOut, AlertCircle } from "lucide-react";

interface PortfolioData {
  portfolio: {
    totalValue: number;
    unrealizedPnl: number;
    availableBalance: number;
    marginUsed: number;
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
    strategy?: string;
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
    totalValue: number;
    totalShares: number;
    nav: number;
    unrealizedPnl: number;
  }>;
  summary: {
    startNav: number;
    endNav: number;
    totalReturn: number;
    dataPoints: number;
  };
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [trades, setTrades] = useState<TradesData | null>(null);
  const [navHistory, setNavHistory] = useState<NavHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

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
      const [portfolioRes, tradesRes, navRes] = await Promise.all([
        fetch("/api/portfolio"),
        fetch("/api/trades?limit=20"),
        fetch("/api/nav/history"),
      ]);

      if (!portfolioRes.ok || !tradesRes.ok) {
        throw new Error("Failed to fetch data");
      }

      const portfolioData = await portfolioRes.json();
      const tradesData = await tradesRes.json();
      const navData = navRes.ok ? await navRes.json() : { history: [], summary: { startNav: 1, endNav: 1, totalReturn: 0, dataPoints: 0 } };

      setPortfolio(portfolioData);
      setTrades(tradesData);
      setNavHistory(navData);
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              CUAN Dashboard
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Welcome, {session.user?.name}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {portfolio?.binanceConfigured && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                Sync Binance
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}

        {!portfolio?.binanceConfigured && (
          <div className="mb-6 p-4 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
            <AlertCircle className="h-5 w-5" />
            Binance API not configured. Add your API keys to .env to enable live data.
          </div>
        )}

        {portfolio && trades && navHistory && (
          <DashboardTabs
            portfolioData={portfolio}
            tradesData={trades}
            navHistory={navHistory}
          />
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          Last updated: {portfolio?.lastUpdated ? new Date(portfolio.lastUpdated).toLocaleString() : "Never"}
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: update dashboard page with tabs

- Fetch NAV history for charts
- Use DashboardTabs component
- Remove inline portfolio rendering"
```

---

## Phase 4: Final Verification

### Task 4.1: Test Full Application

**Step 1: Start fresh**

```bash
cd cuan-dashboard
npm run dev
```

**Step 2: Test all tabs**

1. Login at http://localhost:3000/login
2. Verify **Overview** tab:
   - Portfolio cards show NAV
   - Investor shares display correctly
   - Equity curve renders (if snapshots exist)

3. Verify **Trades** tab:
   - Trade history table loads
   - Strategy column shows

4. Verify **Analytics** tab:
   - Performance metrics display
   - Charts render

5. Verify **Capital** tab:
   - Investor holdings table
   - NAV and total shares correct

**Step 3: Test APIs manually**

```bash
# Get current NAV
curl http://localhost:3000/api/nav/current

# Get NAV history
curl http://localhost:3000/api/nav/history

# Test contribution (as admin)
curl -X POST http://localhost:3000/api/capital/contribute \
  -H "Content-Type: application/json" \
  -d '{"investorId": "xxx", "amount": 10}'
```

---

### Task 4.2: Create Final Commit

```bash
git add -A
git status  # Review all changes
git commit -m "feat: complete CUAN dashboard enhancement

Phase 1: Database + NAV
- Migrate to Supabase (PostgreSQL)
- Add NAV-based share accounting
- Create Investor model (renamed from Founder)
- Add ShareTransaction ledger

Phase 2: Capital Management
- Contribution/redemption APIs
- Automatic share calculation at NAV
- Snapshot on capital events

Phase 3: UI
- Tab-based dashboard (Overview, Trades, Analytics, Capital)
- Recharts visualizations
- Investor holdings table

Ready for production deployment."
```

---

## Summary

| Phase | Tasks | Key Files |
|-------|-------|-----------|
| 1. Foundation | 8 tasks | `prisma/schema.prisma`, `lib/nav.ts`, `app/api/portfolio/route.ts` |
| 2. Capital | 4 tasks | `app/api/capital/*/route.ts`, `app/api/nav/*/route.ts` |
| 3. UI | 4 tasks | `components/dashboard/*.tsx`, `components/charts/*.tsx` |
| 4. Verify | 2 tasks | Testing and final commit |

**Total: ~18 tasks, estimated 2-3 hours**

---

*Plan complete. Ready for implementation.*
