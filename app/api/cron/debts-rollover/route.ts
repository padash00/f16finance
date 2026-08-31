import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: 'debts_rollover_disabled',
      message: 'Weekly debt rollover is disabled. Debts remain assigned to the week in which they were created.',
    },
    { status: 410 },
  )
}
