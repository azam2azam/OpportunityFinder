/**
 * Role-based access control, hospital data segregation and PHI masking.
 *
 * Three things are enforced here and nowhere else:
 *   1. Permission checks   — can this role perform this verb?
 *   2. Hospital scope      — which hospitals' rows may this user see at all?
 *   3. PHI minimisation    — does this user see the patient, or a masked stub?
 *
 * Every data-reading helper in src/lib/queries.ts takes a `Principal` and
 * applies `hospitalFilter` to its `where` clause, so a scope mistake fails
 * closed (empty result) rather than leaking another hospital's patients.
 */

export const PERMISSIONS = [
  // Viewing
  'dashboard.group', // group-wide rollups and hospital comparison
  'dashboard.hospital', // single-hospital command centre
  'opportunity.view',
  'opportunity.view.clinical', // clinical categories (LAB/SURGERY/MEDICATION)
  'opportunity.view.financial', // INSURANCE category and revenue figures
  'patient.view', // open a patient opportunity profile
  'patient.view.phi', // see unmasked name / phone / national ID
  'analytics.view',
  'physician.view',

  // Acting
  'opportunity.assign',
  'opportunity.act', // log calls, SMS, status moves
  'opportunity.close',
  'opportunity.bulk', // bulk assign / bulk status
  'campaign.view',
  'campaign.create',
  'campaign.approve', // a campaign cannot launch without this
  'claim.resubmit',

  // Configuration
  'rules.view',
  'rules.edit',
  'scoring.edit',
  'alerts.edit',
  'admin.users',
  'detection.run',

  // Data ingestion and integration
  'integration.view', // source systems, pipelines, run history, field mappings
  'integration.manage', // enable/disable pipelines, edit mappings and schedules
  'integration.ingest', // upload a file and commit it to the platform

  // Data access
  'askdata.use',
  'askdata.viewsql', // see the generated SQL (authorised technical users)
  'export.data',
  'audit.view',

  // Documentation
  'help.view', // user manual and architecture document — granted to every role
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type ScopeLevel = 'GROUP' | 'MULTI_HOSPITAL' | 'HOSPITAL' | 'DEPARTMENT'

export interface RoleDefinition {
  key: string
  name: string
  scopeLevel: ScopeLevel
  description: string
  permissions: Permission[]
}

const CLINICAL_VIEW: Permission[] = [
  'opportunity.view',
  'opportunity.view.clinical',
  'patient.view',
]

const ACT: Permission[] = ['opportunity.assign', 'opportunity.act', 'opportunity.close']

/**
 * Role catalogue. Group roles carry no `primaryHospitalId`; hospital roles do,
 * and `UserHospitalScope` rows widen a user beyond their primary hospital.
 */
const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: 'GROUP_CEO',
    name: 'Group CEO',
    scopeLevel: 'GROUP',
    description:
      'Group-wide KPIs, opportunity pipeline, hospital comparison, executive alerts.',
    permissions: [
      'dashboard.group',
      'dashboard.hospital',
      'opportunity.view',
      'opportunity.view.clinical',
      'opportunity.view.financial',
      'patient.view',
      'analytics.view',
      'physician.view',
      'campaign.view',
      'campaign.approve',
      'rules.view',
      'alerts.edit',
      'askdata.use',
      'export.data',
    ],
  },
  {
    key: 'GROUP_COO',
    name: 'Group COO',
    scopeLevel: 'GROUP',
    description:
      'Operational performance, opportunity pipeline, action tracking, conversion and revenue recovery.',
    permissions: [
      'dashboard.group',
      'dashboard.hospital',
      'opportunity.view',
      'opportunity.view.clinical',
      'opportunity.view.financial',
      'patient.view',
      'analytics.view',
      'physician.view',
      ...ACT,
      'opportunity.bulk',
      'campaign.view',
      'campaign.create',
      'campaign.approve',
      'rules.view',
      'alerts.edit',
      'askdata.use',
      'export.data',
      'detection.run',
      'integration.view',
    ],
  },
  {
    key: 'GROUP_CMO',
    name: 'Group Chief Medical Officer',
    scopeLevel: 'GROUP',
    description:
      'Clinical opportunities, treatment gaps, follow-up cohorts, chronic care and clinical safety indicators.',
    permissions: [
      'dashboard.group',
      'dashboard.hospital',
      ...CLINICAL_VIEW,
      'patient.view.phi',
      'analytics.view',
      'physician.view',
      'opportunity.assign',
      'opportunity.act',
      'campaign.view',
      'campaign.approve',
      'rules.view',
      'rules.edit',
      'askdata.use',
      'export.data',
    ],
  },
  {
    key: 'GENERAL_DIRECTOR',
    name: 'General Director',
    scopeLevel: 'HOSPITAL',
    description:
      'Hospital command centre: today’s opportunities, priorities, potential revenue, conversion funnel.',
    permissions: [
      'dashboard.hospital',
      'opportunity.view',
      'opportunity.view.clinical',
      'opportunity.view.financial',
      'patient.view',
      'patient.view.phi',
      'analytics.view',
      'physician.view',
      ...ACT,
      'opportunity.bulk',
      'campaign.view',
      'campaign.create',
      'campaign.approve',
      'rules.view',
      'alerts.edit',
      'askdata.use',
      'export.data',
      'detection.run',
      'audit.view',
      'integration.view',
    ],
  },
  {
    key: 'EXECUTIVE_DIRECTOR',
    name: 'Executive Director',
    scopeLevel: 'HOSPITAL',
    description:
      'Department and physician performance, opportunity aging, assignment and conversion status.',
    permissions: [
      'dashboard.hospital',
      'opportunity.view',
      'opportunity.view.clinical',
      'opportunity.view.financial',
      'patient.view',
      'patient.view.phi',
      'analytics.view',
      'physician.view',
      ...ACT,
      'opportunity.bulk',
      'campaign.view',
      'campaign.create',
      'rules.view',
      'askdata.use',
      'export.data',
      'detection.run',
    ],
  },
  {
    key: 'DEPARTMENT_MANAGER',
    name: 'Department Manager',
    scopeLevel: 'DEPARTMENT',
    description: 'Departmental work queue, assignment and conversion of owned opportunities.',
    permissions: [
      'dashboard.hospital',
      'opportunity.view',
      'opportunity.view.clinical',
      'patient.view',
      'patient.view.phi',
      'analytics.view',
      ...ACT,
      'opportunity.bulk',
      'campaign.view',
      'askdata.use',
    ],
  },
  {
    key: 'CARE_NAVIGATOR',
    name: 'Care Navigator',
    scopeLevel: 'HOSPITAL',
    description:
      'Front-line outreach: claims opportunities from the work queue, contacts patients, books appointments.',
    permissions: [
      'opportunity.view',
      'opportunity.view.clinical',
      'patient.view',
      'patient.view.phi',
      'opportunity.act',
      'opportunity.assign',
      'campaign.view',
    ],
  },
  {
    key: 'RCM_SPECIALIST',
    name: 'Revenue Cycle Specialist',
    scopeLevel: 'HOSPITAL',
    description:
      'Insurance recovery: rejection triage, resubmission, documentation and financial counselling.',
    permissions: [
      'opportunity.view',
      'opportunity.view.financial',
      'patient.view',
      'patient.view.phi',
      'opportunity.act',
      'opportunity.assign',
      'opportunity.close',
      'claim.resubmit',
      'analytics.view',
      'askdata.use',
      'export.data',
    ],
  },
  {
    key: 'DATA_ANALYST',
    name: 'Data Analyst',
    scopeLevel: 'GROUP',
    description:
      'Analytics and natural-language data access, including the generated SQL. No patient identifiers.',
    permissions: [
      'dashboard.group',
      'opportunity.view',
      'analytics.view',
      'physician.view',
      'askdata.use',
      'askdata.viewsql',
      'export.data',
      'rules.view',
    ],
  },
  {
    key: 'PLATFORM_ADMIN',
    name: 'Platform Administrator',
    scopeLevel: 'GROUP',
    description:
      'Rules, scoring weights, alerts, users and detection runs. Configuration only — no PHI.',
    permissions: [
      'dashboard.group',
      'opportunity.view',
      'analytics.view',
      'rules.view',
      'rules.edit',
      'scoring.edit',
      'alerts.edit',
      'admin.users',
      'detection.run',
      'audit.view',
      'askdata.use',
      'askdata.viewsql',
      'integration.view',
      'integration.manage',
      'integration.ingest',
    ],
  },
  {
    key: 'AUDITOR',
    name: 'Compliance Auditor',
    scopeLevel: 'GROUP',
    description:
      'Read-only access to audit trails, AI interaction logs and SQL execution history.',
    permissions: ['audit.view', 'analytics.view', 'opportunity.view', 'rules.view', 'integration.view'],
  },
]

/**
 * Help is universal.
 *
 * Granted here rather than listed on each role: a role added later would
 * otherwise ship without access to its own documentation, and nobody would
 * notice until a new user asked where the manual was.
 */
export const ROLES: RoleDefinition[] = ROLE_DEFINITIONS.map((r) => ({
  ...r,
  permissions: [...r.permissions, 'help.view'],
}))

export const ROLE_BY_KEY: Record<string, RoleDefinition> = Object.fromEntries(
  ROLES.map((r) => [r.key, r])
)

/** The authenticated caller, resolved once per request in src/lib/auth.ts. */
export interface Principal {
  userId: string
  email: string
  name: string
  title: string
  roleKey: string
  roleName: string
  scopeLevel: ScopeLevel
  permissions: Permission[]
  primaryHospitalId: string | null
  /** Hospitals this user may read. Empty array means "all" for GROUP scope. */
  hospitalIds: string[]
  departmentScope: string | null
}

export function can(principal: Principal | null, permission: Permission): boolean {
  if (!principal) return false
  return principal.permissions.includes(permission)
}

export function canAny(principal: Principal | null, permissions: Permission[]): boolean {
  return permissions.some((p) => can(principal, p))
}

/**
 * Prisma `where` fragment restricting a query to the principal's hospitals.
 *
 * Group-scope users get `{}` (no restriction). Everyone else gets an explicit
 * `in` list — including the empty list, which matches nothing. That is
 * deliberate: a user with no scope sees no data rather than all data.
 */
export function hospitalFilter(principal: Principal): { hospitalId?: { in: string[] } } {
  if (principal.scopeLevel === 'GROUP') return {}
  return { hospitalId: { in: principal.hospitalIds } }
}

export function canAccessHospital(principal: Principal, hospitalId: string): boolean {
  if (principal.scopeLevel === 'GROUP') return true
  return principal.hospitalIds.includes(hospitalId)
}

/**
 * Categories the principal may see. A CMO gets clinical categories only; an
 * RCM specialist gets INSURANCE only. Used to filter both list queries and the
 * category tiles on the dashboard, so a hidden category never shows a count
 * the user cannot then open.
 */
export function visibleCategories(principal: Principal): string[] {
  const clinical = ['LAB', 'SURGERY', 'MEDICATION']
  const growth = ['REACTIVATION', 'APPOINTMENT', 'REFERRAL', 'SERVICE_LINE']
  const financial = ['INSURANCE']
  const out: string[] = []
  if (can(principal, 'opportunity.view.clinical')) out.push(...clinical)
  if (can(principal, 'opportunity.view.financial')) out.push(...financial)
  // Growth categories carry no clinical detail and no claim amounts, so any
  // holder of the base view permission may see them.
  if (can(principal, 'opportunity.view')) out.push(...growth)
  return [...new Set(out)]
}

// ── PHI minimisation ───────────────────────────────────────────────────

/** Masks "Fatima Al-Harbi" to "F*** A***" for users without patient.view.phi. */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]}${'*'.repeat(Math.max(2, part.length - 1))}`)
    .join(' ')
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  return `${'*'.repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!domain) return '****'
  return `${local[0]}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`
}

export interface PatientIdentity {
  firstName: string
  lastName: string
  mrn: string
  phone: string | null
  email: string | null
  nationalIdMasked: string
}

/**
 * Applies masking in one place so no page can accidentally render raw PHI.
 * The MRN is always shortened for users without PHI rights — it is a direct
 * lookup key into VIDA and is treated as an identifier, not a label.
 */
export function projectPatient<T extends PatientIdentity>(
  principal: Principal,
  patient: T
): T & { displayName: string } {
  const full = `${patient.firstName} ${patient.lastName}`
  if (can(principal, 'patient.view.phi')) {
    return { ...patient, displayName: full }
  }
  return {
    ...patient,
    displayName: maskName(full),
    firstName: maskName(patient.firstName),
    lastName: maskName(patient.lastName),
    mrn: `${patient.mrn.slice(0, 4)}****`,
    phone: maskPhone(patient.phone),
    email: maskEmail(patient.email),
    nationalIdMasked: '**********',
  }
}
