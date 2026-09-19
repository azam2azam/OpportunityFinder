import 'server-only'
import { prisma } from './db'
import { requestContext } from './auth'
import type { Principal } from './rbac'
import type { AuditCategory } from './enums'

export interface AuditInput {
  category: AuditCategory
  action: string
  entityType?: string
  entityId?: string
  /** Set whenever the event touched an identifiable patient record. */
  patientId?: string
  hospitalId?: string
  detail?: Record<string, unknown>
  outcome?: 'SUCCESS' | 'DENIED' | 'ERROR'
}

/**
 * Writes one row to the immutable audit trail.
 *
 * Audit failures never propagate: a logging outage must not take down patient
 * care workflows. The error is surfaced on the server console instead, where
 * the platform's log shipper picks it up.
 */
export async function audit(
  principal: Principal | null,
  input: AuditInput
): Promise<void> {
  try {
    const ctx = await requestContext()
    await prisma.auditEvent.create({
      data: {
        userId: principal?.userId,
        userEmail: principal?.email,
        category: input.category,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        patientId: input.patientId,
        hospitalId: input.hospitalId ?? principal?.primaryHospitalId ?? undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        detail: JSON.stringify(input.detail ?? {}),
        outcome: input.outcome ?? 'SUCCESS',
      },
    })
  } catch (err) {
    console.error('[audit] failed to record event', input.action, err)
  }
}

/**
 * Convenience wrapper for the spec's "patient data access logging" clause:
 * opening a patient opportunity profile is itself an auditable event, separate
 * from anything the user then does.
 */
export async function auditPhiAccess(
  principal: Principal,
  patientId: string,
  context: { via: string; opportunityId?: string; hospitalId?: string }
): Promise<void> {
  await audit(principal, {
    category: 'PHI_ACCESS',
    action: 'PATIENT_RECORD_VIEWED',
    entityType: 'Patient',
    entityId: patientId,
    patientId,
    hospitalId: context.hospitalId,
    detail: { via: context.via, opportunityId: context.opportunityId },
  })
}
