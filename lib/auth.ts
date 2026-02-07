import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

interface ExtendedUser {
  id: string;
  name?: string | null;
  username?: string;
  isAdmin?: boolean;
  isFounder?: boolean;
}

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
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const extUser = user as ExtendedUser;
        token.id = extUser.id;
        token.username = extUser.username || "";
        token.isAdmin = extUser.isAdmin || false;
        token.isFounder = extUser.isFounder || false;
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
};
