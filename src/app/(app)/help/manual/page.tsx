import { guard } from '@/lib/guard'
import { DocView } from '@/components/DocView'
import { USER_MANUAL_DOC } from '@/lib/docs/manual'

export const metadata = {
  title: 'User Manual · Opportuna',
}

export default async function UserManualPage() {
  await guard('help.view')
  return <DocView doc={USER_MANUAL_DOC} />
}
