import type { Permission, Principal } from './rbac'

/**
 * The primary navigation (spec section 4).
 *
 * Each item declares the permission that unlocks it, so the sidebar is derived
 * from the principal rather than hand-maintained per role. An item the user
 * cannot open is never rendered — showing a link that 403s teaches them
 * nothing except that the product is inconsistent.
 */
export interface NavItem {
  href: string
  label: string
  /** Lucide icon name, resolved in the sidebar component. */
  icon: string
  permission: Permission
  /** Shown in a muted second line on wide sidebars. */
  hint?: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAVIGATION: NavGroup[] = [
  {
    title: 'Command',
    items: [
      { href: '/', label: 'Executive Dashboard', icon: 'LayoutDashboard', permission: 'opportunity.view', hint: 'Where are our biggest opportunities today?' },
      { href: '/opportunities', label: 'Opportunity Center', icon: 'Target', permission: 'opportunity.view', hint: 'Every opportunity, filtered and ranked' },
      { href: '/queue', label: 'My Work Queue', icon: 'ListChecks', permission: 'opportunity.act', hint: 'What should I do next?' },
    ],
  },
  {
    title: 'Opportunity types',
    items: [
      { href: '/patients', label: 'Patient Opportunities', icon: 'Users', permission: 'patient.view' },
      { href: '/revenue', label: 'Revenue Opportunities', icon: 'TrendingUp', permission: 'opportunity.view.financial' },
      { href: '/clinical', label: 'Clinical Opportunities', icon: 'Stethoscope', permission: 'opportunity.view.clinical' },
      { href: '/service-lines', label: 'Service-Line Growth', icon: 'GitBranch', permission: 'analytics.view' },
      { href: '/insurance', label: 'Insurance Recovery', icon: 'ShieldCheck', permission: 'opportunity.view.financial' },
      { href: '/reactivation', label: 'Patient Reactivation', icon: 'UserPlus', permission: 'opportunity.view' },
      { href: '/follow-up', label: 'Follow-up & Treatment Gaps', icon: 'CalendarClock', permission: 'opportunity.view' },
    ],
  },
  {
    title: 'Act & analyse',
    items: [
      { href: '/campaigns', label: 'Campaigns / Actions', icon: 'Megaphone', permission: 'campaign.view' },
      { href: '/analytics', label: 'Analytics', icon: 'BarChart3', permission: 'analytics.view' },
      { href: '/ask', label: 'Ask Data', icon: 'MessageSquareText', permission: 'askdata.use', hint: 'Ask the hospital data in plain language' },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { href: '/hospitals', label: 'Hospitals', icon: 'Building2', permission: 'opportunity.view' },
      { href: '/departments', label: 'Departments', icon: 'Network', permission: 'analytics.view' },
      { href: '/physicians', label: 'Physicians', icon: 'UserRound', permission: 'physician.view' },
    ],
  },
  {
    title: 'Data & integration',
    items: [
      { href: '/integration', label: 'Integration Overview', icon: 'Share2', permission: 'integration.view', hint: 'How data reaches the platform' },
      { href: '/integration/sources', label: 'Source Systems', icon: 'Server', permission: 'integration.view' },
      { href: '/integration/pipelines', label: 'Ingestion Pipelines', icon: 'Workflow', permission: 'integration.view' },
      { href: '/integration/mapping', label: 'Field Mapping', icon: 'ArrowLeftRight', permission: 'integration.view' },
      { href: '/integration/upload', label: 'Upload Data', icon: 'Upload', permission: 'integration.ingest', hint: 'Validate a file, then commit it' },
      { href: '/integration/lineage', label: 'Lineage Map', icon: 'Waypoints', permission: 'integration.view', hint: 'Which system feeds which page' },
      { href: '/integration/quality', label: 'Data Quality', icon: 'BadgeCheck', permission: 'integration.view' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { href: '/rules', label: 'Opportunity Rules', icon: 'SlidersHorizontal', permission: 'rules.view' },
      { href: '/admin', label: 'Administration', icon: 'Settings', permission: 'admin.users' },
      { href: '/audit', label: 'Audit & Governance', icon: 'FileSearch', permission: 'audit.view' },
    ],
  },
  {
    title: 'Help',
    items: [
      { href: '/help', label: 'Help & Documentation', icon: 'LifeBuoy', permission: 'help.view', hint: 'How the system works, and how to use it' },
      { href: '/help/manual', label: 'User Manual', icon: 'BookOpen', permission: 'help.view' },
      { href: '/help/architecture', label: 'Architecture & Integration', icon: 'Blocks', permission: 'help.view' },
    ],
  },
]

export function visibleNavigation(principal: Principal): NavGroup[] {
  return NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => principal.permissions.includes(i.permission)),
  })).filter((g) => g.items.length > 0)
}

/**
 * Where a role lands after sign-in. An RCM specialist opening the executive
 * dashboard would see a page mostly composed of tiles they lack permission to
 * drill into; their queue is the useful first screen.
 */
export function landingRoute(principal: Principal): string {
  switch (principal.roleKey) {
    case 'RCM_SPECIALIST':
      return '/insurance'
    case 'CARE_NAVIGATOR':
      return '/queue'
    case 'AUDITOR':
      return '/audit'
    case 'PLATFORM_ADMIN':
      return '/rules'
    case 'DATA_ANALYST':
      return '/analytics'
    default:
      return '/'
  }
}
