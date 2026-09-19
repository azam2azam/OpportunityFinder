/**
 * Evaluates every data-quality check from the command line.
 *
 * Part of the reset pipeline so a freshly seeded platform opens with real
 * quality results rather than an empty screen that cannot be told apart from a
 * broken one.
 */
import { PrismaClient } from '@prisma/client'
import { evaluateQuality } from '../src/lib/ingestion/quality'

const prisma = new PrismaClient()

async function main() {
  const results = await evaluateQuality({ persist: true })
  const failed = results.filter((r) => !r.passed)

  console.log(`Evaluated ${results.length} quality checks — ${results.length - failed.length} passing, ${failed.length} failing`)
  for (const r of results.sort((a, b) => Number(a.passed) - Number(b.passed))) {
    const mark = r.passed ? '\x1b[32mPASS\x1b[0m' : r.severity === 'CRITICAL' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mWARN\x1b[0m'
    console.log(`  ${mark}  ${r.name.padEnd(42)} ${(r.measuredValue * 100).toFixed(1)}% (threshold ${(r.threshold * 100).toFixed(0)}%)`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
