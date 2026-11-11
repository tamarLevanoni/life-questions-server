import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const isTest = process.env.NODE_ENV === 'test'
const connectionString = isTest
  ? process.env.DATABASE_URL_TESTS
  : process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    isTest
      ? 'DATABASE_URL_TESTS is not set — cannot run tests without an isolated database'
      : 'DATABASE_URL is not set'
  )
}

const adapter = new PrismaNeon({ connectionString })

export const prisma = new PrismaClient({ adapter })
