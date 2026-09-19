import { guard } from '@/lib/guard'
import { DocView } from '@/components/DocView'
import { ARCHITECTURE_DOC } from '@/lib/docs/architecture'

export const metadata = {
  title: 'Application Architecture · Opportuna',
}

/**
 * The architecture document and integration guidelines.
 *
 * Content lives in `src/lib/docs/architecture.ts` and is derived from the
 * modules it describes, so the rule count, feed contracts and role tables on
 * this page are read from the running system rather than transcribed.
 */
export default async function ArchitecturePage() {
  await guard('help.view')
  return <DocView doc={ARCHITECTURE_DOC} />
}
