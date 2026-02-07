import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

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
    {
      name: "BB_BOUNCE",
      description: "Bollinger Band bounce strategy",
      isBot: true,
    },
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
