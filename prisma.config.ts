import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use DIRECT_URL (port 5432) for migrations and db push
    // DATABASE_URL uses pooler (port 6543) which is slow for schema operations
    url: process.env["DIRECT_URL"],
  },
});
