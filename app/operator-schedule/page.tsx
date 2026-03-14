import { redirect } from 'next/navigation'

export default function OperatorScheduleRedirectPage() {
  redirect('/operator-dashboard?tab=schedule')
}
