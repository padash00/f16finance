import { NextResponse } from 'next/server';
import { getRequestAccessContext, requireAddon, requireCapability } from '@/lib/api/auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { listOrganizationStaffIds, resolveCompanyScope } from '@/lib/domain/organization-scope';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SettlementRow = {
  id: string;
  staff_id: string;
  organization_id: string | null;
  period_month: string;
  slot: 'first' | 'second';
  scheduled_date: string;
  opened_date: string;
  period_start: string;
  period_end: string;
  base_amount: number;
  bonus_amount: number;
  debt_amount: number;
  fine_amount: number;
  advance_amount: number;
  net_due: number;
  paid_amount: number;
  balance_adjustment: number;
  remaining_amount: number;
  status: string;
  source_payment_id: number | null;
  snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type StaffRow = {
  id: string;
  full_name: string;
  short_name: string | null;
};

type EventRow = {
  id: string;
  settlement_id: string;
  event_type: string;
  amount: number;
  balance_delta: number;
  before_remaining: number;
  after_remaining: number;
  business_date: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function toInt(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedOrganizationId = url.searchParams.get('organizationId');
    const requestedMonth = url.searchParams.get('month');
    const requestedStaffId = url.searchParams.get('staffId');

    const ctx = await getRequestAccessContext('f16finance');
    requireAddon(ctx, 'staff_salary');
    requireCapability(ctx, 'salary.view');

    const companyScope = await resolveCompanyScope(ctx, requestedOrganizationId);
    const db = createAdminSupabaseClient();
    const allowedStaffIds = await listOrganizationStaffIds(db, companyScope.organizationIds);

    if (allowedStaffIds.length === 0) {
      return NextResponse.json({
        rows: [],
        events: [],
        totals: { due: 0, paid: 0, remaining: 0, adjustments: 0, openCount: 0 },
      });
    }

    if (requestedStaffId && !allowedStaffIds.includes(requestedStaffId)) {
      return NextResponse.json({ error: 'Сотрудник недоступен в выбранной организации.' }, { status: 403 });
    }

    const staffIds = requestedStaffId ? [requestedStaffId] : allowedStaffIds;
    let settlementQuery = db
      .from('staff_salary_settlements')
      .select('*')
      .in('staff_id', staffIds)
      .order('scheduled_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)) {
      const monthStart = `${requestedMonth}-01`;
      const [year, month] = requestedMonth.split('-').map(Number);
      const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      settlementQuery = settlementQuery.gte('period_month', monthStart).lt('period_month', nextMonth);
    }

    const [{ data: settlements, error: settlementsError }, { data: staff, error: staffError }] = await Promise.all([
      settlementQuery,
      db.from('staff').select('id,full_name,short_name').in('id', staffIds),
    ]);

    if (settlementsError) throw settlementsError;
    if (staffError) throw staffError;

    const settlementRows = (settlements ?? []) as SettlementRow[];
    const staffRows = (staff ?? []) as StaffRow[];
    const staffById = new Map(staffRows.map((row) => [row.id, row]));

    let events: EventRow[] = [];
    const settlementIds = settlementRows.map((row) => row.id);
    if (settlementIds.length > 0) {
      const { data: eventRows, error: eventError } = await db
        .from('staff_salary_settlement_events')
        .select('id,settlement_id,event_type,amount,balance_delta,before_remaining,after_remaining,business_date,metadata,created_at')
        .in('settlement_id', settlementIds)
        .order('created_at', { ascending: false })
        .limit(500);
      if (eventError) throw eventError;
      events = (eventRows ?? []) as EventRow[];
    }

    const rows = settlementRows.map((row) => {
      const person = staffById.get(row.staff_id);
      return {
        ...row,
        staff_name: person?.short_name || person?.full_name || 'Сотрудник',
        staff_full_name: person?.full_name || null,
      };
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.due += toInt(row.net_due);
        acc.paid += toInt(row.paid_amount);
        acc.remaining += Math.max(toInt(row.remaining_amount), 0);
        acc.adjustments += toInt(row.balance_adjustment);
        if (toInt(row.remaining_amount) > 0) acc.openCount += 1;
        return acc;
      },
      { due: 0, paid: 0, remaining: 0, adjustments: 0, openCount: 0 },
    );

    return NextResponse.json(
      { rows, events, totals },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    console.error('[staff-salary-settlements] GET failed', error);
    const message = error instanceof Error ? error.message : 'Не удалось загрузить расчёты зарплаты.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
