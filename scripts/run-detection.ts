/**
 * Runs the opportunity detection engine from the command line.
 *
 * In a deployed environment this is what the scheduler invokes (nightly, or on
 * CDC arrival); here it is also how the pipeline is first populated after a
 * seed. `--reset` clears the pipeline first, which is what you want after
 * reseeding — without it, opportunities from the previous population survive as
 * orphans pointing at patients that no longer exist.
 */
import { PrismaClient } from '@prisma/client'
import { runDetection, syncRuleCatalogue } from '../src/lib/detection/engine'

const prisma = new PrismaClient()

async function main() {
  const args = process.argv.slice(2)
  const reset = args.includes('--reset')
  const ruleArg = args.find((a) => a.startsWith('--rules='))
  const ruleKeys = ruleArg ? ruleArg.slice('--rules='.length).split(',') : undefined

  if (reset) {
    console.log('Clearing existing opportunity pipeline...')
    await prisma.conversion.deleteMany({})
    await prisma.opportunityAction.deleteMany({})
    await prisma.campaignMember.deleteMany({})
    await prisma.communication.deleteMany({})
    await prisma.opportunity.deleteMany({})
  }

  const added = await syncRuleCatalogue(prisma)
  if (added > 0) console.log(`Added ${added} new rules from the catalogue.`)

  console.log('Running detection...')
  const result = await runDetection(prisma, { triggeredBy: 'cli', ruleKeys })

  const byCategory = new Map<string, number>()
  for (const s of result.stats) {
    const rule = await prisma.opportunityRule.findUnique({ where: { key: s.ruleKey } })
    const cat = rule?.category ?? 'UNKNOWN'
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + s.created + s.updated)
  }

  console.log('\nPer-rule results:')
  const width = Math.max(...result.stats.map((s) => s.ruleKey.length))
  for (const s of result.stats.sort((a, b) => b.created - a.created)) {
    console.log(
      `  ${s.ruleKey.padEnd(width)}  created ${String(s.created).padStart(5)}` +
        `  updated ${String(s.updated).padStart(5)}` +
        `  suppressed ${String(s.suppressed).padStart(4)}` +
        `  ${s.durationMs}ms`
    )
  }

  console.log('\nBy category:')
  for (const [cat, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(14)} ${count}`)
  }

  const zeroYield = result.stats.filter((s) => s.created + s.updated + s.suppressed === 0)
  if (zeroYield.length > 0) {
    console.log(`\nRules with no matches: ${zeroYield.map((s) => s.ruleKey).join(', ')}`)
  }

  const totals = await prisma.opportunity.aggregate({
    _count: true,
    _sum: { potentialValue: true },
  })
  console.log(
    `\nPipeline: ${totals._count} opportunities, ` +
      `SAR ${Math.round(totals._sum.potentialValue ?? 0).toLocaleString()} potential value`
  )
  console.log(`Run ${result.runId} finished in ${(result.totals.durationMs / 1000).toFixed(1)}s`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
