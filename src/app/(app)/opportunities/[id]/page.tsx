import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import clsx from 'clsx'
import { getPrincipal } from '@/lib/auth'
import { getOpportunity, getPatientTimeline } from '@/lib/queries'
import { auditPhiAccess, audit } from '@/lib/audit'
import { can, projectPatient } from '@/lib/rbac'
import { money, percent, shortDate, dateTime, relative, ageDays, humanise } from '@/lib/format'
import { CATEGORY_LABEL, ACTION_LABEL, isTerminal, type ActionType } from '@/lib/enums'
import type { FactorContribution } from '@/lib/scoring'
import {
  Card, PageHeader, SectionHeader, PriorityBadge, StatusBadge, CategoryBadge,
  ScorePill, SlaBadge, Stat, TableShell, MiniBar,
} from '@/components/ui'
import { ActionPanel } from '@/components/client/ActionPanel'

export const dynamic = 'force-dynamic'

/**
 * The Patient Opportunity Profile (spec section 15).
 *
 * This is where the platform has to justify itself. Every element answers one
 * of the spec's ten questions — who, what, why, when, where, how important, how
 * much value, what should we do, who owns it, what happened — and the "why"
 * is given as the detector's own narrative plus the weighted factors that
 * produced the score, never as a bare number.
 *
 * Opening this page is itself a PHI access event and is audited before
 * anything renders.
 */
export default async function OpportunityDetail({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal()
  if (!principal) redirect('/login')

  const { id } = await params
  const opportunity = await getOpportunity(principal, id)
  // Out of scope and non-existent are indistinguishable by design: a 403 here
  // would confirm that an opportunity with this id exists at another hospital.
  if (!opportunity) notFound()

  if (opportunity.patientId) {
    await auditPhiAccess(principal, opportunity.patientId, {
      via: 'OPPORTUNITY_PROFILE',
      opportunityId: opportunity.id,
      hospitalId: opportunity.hospitalId,
    })
  } else {
    await audit(principal, {
      category: 'OPPORTUNITY',
      action: 'OPPORTUNITY_VIEWED',
      entityType: 'Opportunity',
      entityId: opportunity.id,
      hospitalId: opportunity.hospitalId,
    })
  }

  const timeline = opportunity.patientId ? await getPatientTimeline(opportunity.patientId) : []
  const patient = opportunity.patient ? projectPatient(principal, opportunity.patient) : null
  const breakdown = parseBreakdown(opportunity.scoreBreakdown)
  const evidence = parseEvidence(opportunity.evidence)
  const closed = isTerminal(opportunity.status)
  const canAct = can(principal, 'opportunity.act')

  // The stored narrative is "observation\n\nScored N — P priority. Contributing
  // factors:\n• …". Split it so the observation reads as prose and the factors
  // read as a list.
  const [observation, ...rationale] = opportunity.detectionReason.split('\n\n')
  const reasonBullets = rationale
    .join('\n')
    .split('\n')
    .filter((l) => l.trim().startsWith('•'))
    .map((l) => l.replace(/^•\s*/, ''))

  const contributing = breakdown
    .filter((b) => b.weight > 0)
    .sort((a, b) => b.contribution - a.contribution)
  const maxContribution = Math.max(1, ...contributing.map((b) => b.contribution))

  return (
    <div className="space-y-5">
      <PageHeader
        title={opportunity.title}
        description={`${opportunity.reference} · detected ${shortDate(opportunity.detectedAt)} by rule ${opportunity.rule.name}`}
        actions={
          <>
            <Link href="/opportunities" className="btn btn-secondary">
              Back to list
            </Link>
            {can(principal, 'rules.view') && (
              <Link href={`/rules/${opportunity.ruleId}`} className="btn btn-secondary">
                View rule
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={opportunity.priority} />
        <StatusBadge status={opportunity.status} />
        <CategoryBadge
          category={opportunity.category}
          label={CATEGORY_LABEL[opportunity.category as keyof typeof CATEGORY_LABEL]}
        />
        <span className="chip border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
          {opportunity.hospital.name}
        </span>
        {opportunity.specialty && (
          <span className="chip border-ink-200 bg-white text-ink-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300">
            {opportunity.specialty.name}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
          SLA <SlaBadge dueAt={opportunity.slaDueAt} closed={closed} />
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* WHY — the explainability requirement, section 17. */}
          <Card>
            <SectionHeader
              title="Why this was detected"
              description="The observation that triggered this opportunity, in the detector’s own words."
            />
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-200">
              {observation}
            </p>

            {reasonBullets.length > 0 && (
              <div className="mt-4 rounded-md border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/40">
                <p className="text-sm font-medium text-brand-900 dark:text-brand-100">
                  {humanise(opportunity.priority)} priority because:
                </p>
                <ul className="mt-1.5 space-y-1">
                  {reasonBullets.map((r, i) => (
                    <li key={i} className="flex gap-2 text-sm text-brand-900/90 dark:text-brand-100/90">
                      <span aria-hidden className="text-brand-400">
                        •
                      </span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-4 border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-500 dark:border-ink-800 dark:text-ink-400">
              This is a pattern found in recorded data, scored against a configurable model — not a
              clinical decision. A qualified clinician decides whether action is appropriate for
              this patient. Rule{' '}
              <span className="font-mono">{opportunity.rule.key}</span> v{opportunity.rule.version},
              scored with{' '}
              <span className="font-medium">{opportunity.scoringModel?.name ?? 'the default model'}</span>,
              confidence {percent(opportunity.confidence, 0)}.
            </p>
          </Card>

          {/* HOW IMPORTANT — the score, decomposed. */}
          <Card>
            <SectionHeader
              title="Score breakdown"
              description="Every factor, its measured value, its configured weight and what it contributed."
              action={<ScorePill score={opportunity.score} />}
            />
            <TableShell
              head={
                <>
                  <th className="th">Factor</th>
                  <th className="th">What was measured</th>
                  <th className="th text-right">Measured</th>
                  <th className="th text-right">Weight</th>
                  <th className="th text-right">Contribution</th>
                  <th className="th">Share</th>
                </>
              }
            >
              {contributing.map((b) => (
                <tr key={b.factor}>
                  <td className="td whitespace-nowrap font-medium text-ink-900 dark:text-ink-100">
                    {b.label}
                  </td>
                  <td className="td max-w-sm text-xs text-ink-600 dark:text-ink-300">{b.explanation}</td>
                  <td className="td tabular text-right">{b.normalised.toFixed(0)}</td>
                  <td className="td tabular text-right text-ink-500">{b.weight}</td>
                  <td className="td tabular text-right font-medium">{b.contribution.toFixed(0)}</td>
                  <td className="td">
                    <MiniBar value={b.contribution} max={maxContribution} />
                  </td>
                </tr>
              ))}
            </TableShell>
            <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
              Weights are set in the active scoring model and can be retuned by an administrator
              without changing any code. The score is the weighted mean of the normalised factors,
              so changing one weight moves every opportunity consistently.
            </p>
          </Card>

          {/* WHAT SHOULD WE DO */}
          <Card>
            <SectionHeader title="Recommended action" description="What the platform suggests doing next." />
            <div className="rounded-md bg-ink-50 p-3 dark:bg-ink-800/60">
              <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                {opportunity.recommendedAction}
              </p>
              <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                Suggested channel: {humanise(opportunity.recommendedChannel)}
                {patient && ` · patient prefers ${humanise(opportunity.patient?.preferredChannel ?? '')}`}
                {opportunity.patient && !opportunity.patient.contactable && (
                  <span className="ml-1 font-medium text-warn-700 dark:text-warn-500">
                    · patient has opted out of contact
                  </span>
                )}
              </p>
            </div>

            {canAct ? (
              <ActionPanel
                opportunityId={opportunity.id}
                status={opportunity.status}
                category={opportunity.category}
                closed={closed}
                canClose={can(principal, 'opportunity.close')}
                canAssign={can(principal, 'opportunity.assign')}
              />
            ) : (
              <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
                Your role has read-only access to opportunities. Logging actions requires the
                opportunity.act permission.
              </p>
            )}
          </Card>

          {/* Evidence — traceability back to VIDA. */}
          <Card>
            <SectionHeader
              title="Source evidence"
              description="The records the detector read, so any figure above can be traced back to the source system."
            />
            <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {evidence.map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="label">{humanise(key.replace(/([A-Z])/g, ' $1'))}</dt>
                  <dd className="mt-0.5 break-words text-sm text-ink-800 dark:text-ink-200">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* WHAT HAPPENED */}
          <Card>
            <SectionHeader
              title="Action history"
              description="Everything anyone has done on this opportunity, and when."
            />
            {opportunity.actions.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-400">
                No action taken yet. This opportunity is waiting to be picked up.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-ink-200 pl-4 dark:border-ink-700">
                {opportunity.actions.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-4 ring-white dark:ring-ink-900" />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                        {ACTION_LABEL[a.type as ActionType] ?? humanise(a.type)}
                        {a.toStatus && a.fromStatus !== a.toStatus && (
                          <span className="ml-2 text-xs font-normal text-ink-500">
                            {humanise(a.fromStatus)} → {humanise(a.toStatus)}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-400">{dateTime(a.performedAt)}</p>
                    </div>
                    {a.note && (
                      <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">{a.note}</p>
                    )}
                    <p className="mt-0.5 text-xs text-ink-400">
                      {a.performedBy.name} · {a.performedBy.title}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        {/* Right rail — who, how much, who owns it. */}
        <div className="space-y-4">
          <Card>
            <SectionHeader title="Value & ownership" />
            <dl className="space-y-3">
              <Stat label="Potential value" value={money(opportunity.potentialValue)} />
              {opportunity.realisedValue > 0 && (
                <Stat
                  label="Realised value"
                  value={money(opportunity.realisedValue)}
                  tone="text-positive-600 dark:text-positive-500"
                />
              )}
              <Stat label="Conversion probability" value={percent(opportunity.conversionProbability, 0)} />
              <Stat label="Clinical urgency" value={`${opportunity.clinicalUrgency} / 100`} />
              <Stat
                label="Owner"
                value={
                  opportunity.owner ? (
                    <>
                      {opportunity.owner.name}
                      <span className="block text-xs font-normal text-ink-500">
                        {opportunity.owner.title}
                      </span>
                    </>
                  ) : (
                    <span className="text-warn-700 dark:text-warn-500">Unassigned</span>
                  )
                }
              />
              <Stat label="Owning team" value={humanise(opportunity.ownerTeam)} />
              <Stat label="Age" value={`${ageDays(opportunity.detectedAt)} days`} />
              <Stat
                label="Next action due"
                value={opportunity.nextActionAt ? relative(opportunity.nextActionAt) : '—'}
              />
              {opportunity.conversion && (
                <Stat
                  label="Converted"
                  value={`${humanise(opportunity.conversion.conversionType)} after ${opportunity.conversion.daysToConvert} days`}
                  tone="text-positive-600 dark:text-positive-500"
                />
              )}
              {opportunity.outcomeNote && <Stat label="Outcome" value={opportunity.outcomeNote} />}
            </dl>
          </Card>

          {patient && opportunity.patient && (
            <Card>
              <SectionHeader
                title="Patient"
                description={can(principal, 'patient.view.phi') ? undefined : 'Identifiers masked for your role.'}
              />
              <dl className="space-y-3">
                <Stat label="Name" value={patient.displayName} />
                <Stat label="MRN" value={<span className="font-mono text-xs">{patient.mrn}</span>} />
                <Stat
                  label="Age / gender"
                  value={`${Math.floor(
                    (Date.now() - opportunity.patient.dateOfBirth.getTime()) / (365.25 * 86_400_000)
                  )} · ${opportunity.patient.gender === 'M' ? 'Male' : 'Female'}`}
                />
                <Stat label="Contact" value={patient.phone ?? 'No number on file'} />
                <Stat
                  label="Contactable"
                  value={
                    opportunity.patient.contactable ? (
                      'Yes'
                    ) : (
                      <span className="text-warn-700 dark:text-warn-500">Opted out</span>
                    )
                  }
                />
                <Stat label="Preferred channel" value={humanise(opportunity.patient.preferredChannel)} />
                <Stat label="Last encounter" value={relative(opportunity.patient.lastEncounterAt)} />
                <Stat
                  label="Primary physician"
                  value={
                    opportunity.patient.primaryPhysician ? (
                      <>
                        {opportunity.patient.primaryPhysician.name}
                        <span className="block text-xs font-normal text-ink-500">
                          {opportunity.patient.primaryPhysician.specialty.name}
                        </span>
                      </>
                    ) : (
                      '—'
                    )
                  }
                />
                <Stat
                  label="Insurance"
                  value={
                    opportunity.patient.payer
                      ? `${opportunity.patient.payer.name} (${humanise(opportunity.patient.insuranceStatus)})`
                      : humanise(opportunity.patient.insuranceStatus)
                  }
                />
                <Stat label="Distance" value={`${Math.round(opportunity.patient.distanceKm)} km`} />
              </dl>
              <Link
                href={`/patients?q=${encodeURIComponent(opportunity.patient.mrn)}`}
                className="btn btn-secondary mt-4 w-full"
              >
                All opportunities for this patient
              </Link>
            </Card>
          )}

          {opportunity.physician && (
            <Card>
              <SectionHeader title="Responsible clinician" />
              <dl className="space-y-3">
                <Stat label="Physician" value={opportunity.physician.name} />
                <Stat label="Specialty" value={opportunity.physician.specialty.name} />
                <Stat label="Department" value={opportunity.department?.name ?? '—'} />
              </dl>
            </Card>
          )}
        </div>
      </div>

      {/* WHEN — the merged clinical timeline. */}
      {timeline.length > 0 && (
        <Card>
          <SectionHeader
            title="Patient timeline"
            description="Registration through follow-up, merged across every source domain."
          />
          <ol className="relative space-y-3 border-l border-ink-200 pl-4 dark:border-ink-700">
            {timeline.map((e, i) => (
              <li key={i} className="relative">
                <span
                  className={clsx(
                    'absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-4 ring-white dark:ring-ink-900',
                    e.emphasis === 'critical'
                      ? 'bg-critical-solid'
                      : e.emphasis === 'warning'
                        ? 'bg-warn-500'
                        : e.emphasis === 'positive'
                          ? 'bg-positive-500'
                          : 'bg-ink-300 dark:bg-ink-600'
                  )}
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-100">
                    <span className="mr-2 text-2xs font-semibold uppercase tracking-wide text-ink-400">
                      {e.kind.replace('_', ' ')}
                    </span>
                    {e.title}
                  </p>
                  <p className="text-xs text-ink-400">{shortDate(e.at)}</p>
                </div>
                <p className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">{e.detail}</p>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}

function parseBreakdown(raw: string): FactorContribution[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as FactorContribution[]) : []
  } catch {
    return []
  }
}

/** Flattens the evidence blob into label/value pairs fit for display. */
function parseEvidence(raw: string): Array<[string, string]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []

  return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => {
    if (v == null) return [k, '—'] as [string, string]
    if (Array.isArray(v)) return [k, v.length ? v.join(', ') : '—'] as [string, string]
    if (typeof v === 'boolean') return [k, v ? 'Yes' : 'No'] as [string, string]
    if (typeof v === 'number') {
      // Money-ish keys read better formatted; everything else stays raw so a
      // days count is not rendered as currency.
      return [k, /amount|value|rejected|recoverable|charge/i.test(k) ? money(v) : String(v)] as [string, string]
    }
    if (typeof v === 'string') {
      const asDate = /At$|Date$/.test(k) ? new Date(v) : null
      if (asDate && !Number.isNaN(asDate.getTime())) return [k, shortDate(asDate)] as [string, string]
      return [k, v] as [string, string]
    }
    return [k, JSON.stringify(v)] as [string, string]
  })
}
