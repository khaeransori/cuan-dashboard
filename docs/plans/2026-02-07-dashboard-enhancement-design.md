# CUAN Dashboard Enhancement Design

**Date:** 2026-02-07
**Status:** Ready for Implementation
**Goal:** Enhance dashboard with performance visualization, trade analytics, and hedge fund-ready capital management

---

## 1. Overview

### What We're Building

An enhanced investment dashboard that tracks a shared fund with proper hedge fund accounting, ready to scale from 3 founders to multiple LPs.

### Core Concepts

```
┌─────────────────────────────────────────────────────────┐
│                      CUAN Fund                          │
├─────────────────────────────────────────────────────────┤
│  Assets: Binance Futures Account                        │
│  ├── Cash (USDT balance)                                │
│  ├── Open Positions (unrealized P&L)                    │
│  └── Total Value = Cash + Unrealized                    │
├─────────────────────────────────────────────────────────┤
│  Shares: 18 total                                       │
│  ├── Aan: 6 shares                                      │
│  ├── Dhanu: 6 shares                                    │
│  └── Gladys: 6 shares                                   │
├─────────────────────────────────────────────────────────┤
│  NAV = Total Value ÷ Total Shares                       │
│  Each investor's value = Their Shares × NAV             │
└─────────────────────────────────────────────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fund model | Hybrid (Friends & Family → Professional LP) | Start simple, architect for scale |
| Capital accounting | Share-based NAV | Industry standard, scales to unlimited LPs |
| Charting | Recharts | React-native, lightweight, shadcn-compatible |
| Trade tagging | Strategy + Symbol + Setup | Balance between useful and not burdensome |
| Snapshot frequency | Daily + on transactions | Standard hedge fund reporting |
| Migration | Clean start, NAV = $1.00 at inception | Simple, preserves historical performance |
| UI structure | Tab-based single dashboard | Focused UX for small team |
| Database | Supabase (PostgreSQL) + Prisma | Production-ready, existing ORM |

---

## 2. NAV (Net Asset Value) System

### How NAV Works

```
NAV = Total Fund Value ÷ Total Shares Outstanding
```

NAV is the price per share. It changes only from trading performance, not from contributions/redemptions.

### Example Scenarios

**Initial State:**
```
Total Fund: $18
Total Shares: 18
NAV: $1.00

Aan: 6 shares × $1.00 = $6.00
Dhanu: 6 shares × $1.00 = $6.00
Gladys: 6 shares × $1.00 = $6.00
```

**After 50% Trading Gain:**
```
Total Fund: $27
Total Shares: 18 (unchanged)
NAV: $1.50

Each founder: 6 × $1.50 = $9.00
```

**Contribution ($100 at NAV $1.50):**
```
New shares issued: $100 ÷ $1.50 = 66.67 shares

After:
Total Fund: $127
Total Shares: 84.67
NAV: $1.50 (unchanged - fair pricing!)

New ownership:
- Contributor: 66.67 shares (78.8%)
- Others: 6 shares each (7.1% each)
```

**Redemption ($4.50 at NAV $1.50):**
```
Shares redeemed: $4.50 ÷ $1.50 = 3 shares

After:
Total Fund: $122.50
Total Shares: 81.67
NAV: $1.50 (unchanged - fair pricing!)
```

### Key Insight

> NAV stays constant during contributions/redemptions. If it changes, someone got a bad deal.

---

## 3. Database Schema

### Migration: SQLite → Supabase (PostgreSQL)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")  // Supabase connection string
}
```

### Schema Changes

```prisma
// ─────────────────────────────────────────────
// RENAMED: Founder → Investor
// ─────────────────────────────────────────────
model Investor {
  id            String   @id @default(cuid())
  username      String   @unique
  password      String
  name          String
  email         String?
  isAdmin       Boolean  @default(false)
  isFounder     Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  shares        ShareTransaction[]
  transactions  Transaction[]
}

// ─────────────────────────────────────────────
// NEW: Share ledger
// ─────────────────────────────────────────────
model ShareTransaction {
  id               String   @id @default(cuid())
  investorId       String
  investor         Investor @relation(fields: [investorId], references: [id])
  type             String   // BUY, SELL, INITIAL
  shares           Float    // positive = buy, negative = sell
  navAtTransaction Float
  amount           Float    // USD value
  timestamp        DateTime @default(now())
}

// ─────────────────────────────────────────────
// MODIFIED: Snapshot (add NAV)
// ─────────────────────────────────────────────
model Snapshot {
  id            String   @id @default(cuid())
  totalValue    Float
  totalShares   Float
  nav           Float
  availableUsdt Float
  unrealizedPnl Float    @default(0)
  marginUsed    Float    @default(0)
  btcPrice      Float?
  trigger       String   @default("daily")
  timestamp     DateTime @default(now())
}

// ─────────────────────────────────────────────
// MODIFIED: Trade (add tagging)
// ─────────────────────────────────────────────
model Trade {
  id            String    @id @default(cuid())
  binanceId     String    @unique
  symbol        String
  side          String
  positionSide  String
  entryPrice    Float
  exitPrice     Float?
  quantity      Float
  leverage      Int       @default(1)
  margin        Float?
  pnl           Float?
  pnlPercent    Float?
  commission    Float     @default(0)
  status        String    @default("OPEN")
  openedAt      DateTime
  closedAt      DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // NEW fields
  strategy      String?
  setup         String?
  notes         String?
  rating        Int?
}

// ─────────────────────────────────────────────
// NEW: Strategy reference
// ─────────────────────────────────────────────
model Strategy {
  id            String   @id @default(cuid())
  name          String   @unique
  description   String?
  isBot         Boolean  @default(false)
  isActive      Boolean  @default(true)
}

// ─────────────────────────────────────────────
// MODIFIED: Transaction (link to Investor)
// ─────────────────────────────────────────────
model Transaction {
  id            String    @id @default(cuid())
  type          String
  amount        Float
  currency      String    @default("USDT")
  investorId    String?
  investor      Investor? @relation(fields: [investorId], references: [id])
  description   String?
  txHash        String?
  timestamp     DateTime  @default(now())
}

// ─────────────────────────────────────────────
// KEEP: Settings
// ─────────────────────────────────────────────
model Setting {
  id            String   @id @default(cuid())
  key           String   @unique
  value         String
  updatedAt     DateTime @updatedAt
}
```

### Migration Steps

1. Create Supabase project
2. Update `.env` with Supabase connection string
3. Change provider to `postgresql`
4. Run `npx prisma migrate dev --name init`
5. Seed initial data:
   - 3 Investors (Aan, Dhanu, Gladys)
   - 3 ShareTransactions (6 shares each, type: INITIAL, NAV: $1.00)
   - Initial snapshot with NAV
   - Default strategies (BB_BOUNCE, MANUAL, SCALP)
6. Backfill NAV on existing snapshots: `nav = totalValue / 18`

---

## 4. API Endpoints

### Existing (Modified)

```
GET /api/portfolio
  + nav, totalShares, investors[].shares

GET /api/trades
  + ?strategy=&setup=&rating= filters
```

### New Endpoints

```
# NAV & Snapshots
GET  /api/nav/history?from=&to=        → NAV history for charts
GET  /api/nav/current                  → Latest NAV data

# Capital Management
POST /api/capital/contribute           → { investorId, amount }
POST /api/capital/redeem               → { investorId, shares|amount }
GET  /api/capital/transactions         → Share transaction history

# Analytics
GET  /api/analytics/performance        → Win rate, Sharpe, profit factor
GET  /api/analytics/by-strategy        → P&L by strategy
GET  /api/analytics/by-symbol          → P&L by symbol
GET  /api/analytics/drawdown           → Drawdown history

# Trade Journal
PATCH /api/trades/:id                  → Update strategy, setup, notes, rating

# Reference Data
GET  /api/strategies                   → List strategies
POST /api/strategies                   → Create strategy (admin)
```

---

## 5. UI Structure

### Tab-Based Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  💰 CUAN Dashboard                    [Sync] [Refresh] [👤] │
├─────────────────────────────────────────────────────────────┤
│  [Overview]  [Trades]  [Analytics]  [Capital]               │
└─────────────────────────────────────────────────────────────┘
```

### Tab: Overview

- Portfolio summary cards (Total Value, NAV, Unrealized P&L, Win Rate)
- Equity curve chart (NAV over time)
- Investor shares breakdown
- Open positions table

### Tab: Trades

- Full trade history with pagination
- Filters: symbol, strategy, setup, status, date range
- Click to expand: trade details + journal
- Edit: strategy, setup, notes, rating

### Tab: Analytics

**Performance Metrics:**
- Total P&L, Win Rate, Avg Win, Avg Loss
- Profit Factor, Sharpe Ratio, Max Drawdown

**Charts:**
- P&L over time (area chart)
- Drawdown (inverted area chart)
- P&L by strategy (bar chart)
- P&L by symbol (bar chart)
- Win/Loss distribution (bar chart)

### Tab: Capital

- Current share ownership table
- NAV history chart
- Contribution/Redemption form (admin)
- Share transaction history

---

## 6. Charts (Recharts)

### Required Charts

| Chart | Type | Data Source |
|-------|------|-------------|
| Equity Curve | Line | /api/nav/history |
| P&L Over Time | Area | /api/nav/history (derived) |
| Drawdown | Area (inverted) | /api/analytics/drawdown |
| P&L by Strategy | Bar | /api/analytics/by-strategy |
| P&L by Symbol | Bar | /api/analytics/by-symbol |
| Win/Loss Distribution | Bar | /api/analytics/performance |
| NAV History | Line | /api/nav/history |

### Chart Components

```tsx
// components/charts/equity-curve.tsx
// components/charts/pnl-chart.tsx
// components/charts/drawdown-chart.tsx
// components/charts/strategy-breakdown.tsx
// components/charts/symbol-breakdown.tsx
```

---

## 7. Implementation Phases

### Phase 1: Foundation (Database + NAV)

1. Set up Supabase project
2. Migrate schema to PostgreSQL
3. Implement NAV calculation logic
4. Migrate existing data (founders → investors, backfill NAV)
5. Update /api/portfolio to include NAV data

### Phase 2: Capital Management

1. Implement ShareTransaction model
2. Build /api/capital/* endpoints
3. Add Capital tab UI
4. Contribution/redemption flows

### Phase 3: Trade Analytics

1. Add strategy/setup/notes/rating to Trade model
2. Build /api/analytics/* endpoints
3. Add trade journal UI (edit trades)
4. Add Analytics tab with charts

### Phase 4: Visualization

1. Install Recharts
2. Build chart components
3. Integrate into Overview and Analytics tabs
4. Add date range pickers

### Phase 5: Polish

1. Responsive design fixes
2. Loading states
3. Error handling
4. Empty states

---

## 8. Future: Professional LP Structure

When ready to accept external investors:

| Feature | Add |
|---------|-----|
| Investor onboarding | KYC fields, accreditation status |
| Fee structure | Management fee (2%), performance fee (20%) |
| High-water mark | Track peak NAV per investor |
| Lock-up periods | Minimum investment duration |
| Redemption windows | Quarterly with 30-day notice |
| Gates | Max 25% redemption per quarter |
| Reporting | Monthly statements, K-1 generation |

The current schema supports all of this with minimal changes.

---

## 9. File Structure (New/Modified)

```
cuan-dashboard/
├── app/
│   ├── dashboard/
│   │   └── page.tsx              # Refactor to tab-based
│   └── api/
│       ├── nav/
│       │   ├── current/route.ts
│       │   └── history/route.ts
│       ├── capital/
│       │   ├── contribute/route.ts
│       │   ├── redeem/route.ts
│       │   └── transactions/route.ts
│       ├── analytics/
│       │   ├── performance/route.ts
│       │   ├── by-strategy/route.ts
│       │   ├── by-symbol/route.ts
│       │   └── drawdown/route.ts
│       ├── strategies/route.ts
│       └── trades/
│           └── [id]/route.ts     # PATCH for journal
├── components/
│   ├── dashboard/
│   │   ├── tabs.tsx
│   │   ├── overview-tab.tsx
│   │   ├── trades-tab.tsx
│   │   ├── analytics-tab.tsx
│   │   └── capital-tab.tsx
│   └── charts/
│       ├── equity-curve.tsx
│       ├── pnl-chart.tsx
│       ├── drawdown-chart.tsx
│       ├── strategy-breakdown.tsx
│       └── symbol-breakdown.tsx
├── lib/
│   ├── nav.ts                    # NAV calculation helpers
│   └── analytics.ts              # Analytics calculations
├── prisma/
│   ├── schema.prisma             # Updated schema
│   └── seed.ts                   # Updated seed
└── docs/
    └── plans/
        └── 2026-02-07-dashboard-enhancement-design.md
```

---

*Design complete. Ready for implementation.*
