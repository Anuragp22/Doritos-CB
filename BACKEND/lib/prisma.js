// @prisma/client v7 ships as CommonJS. Standard Node ESM-to-CJS interop:
// destructure the named export from the default import.
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const { PrismaClient } = prismaPkg;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export default prisma;
