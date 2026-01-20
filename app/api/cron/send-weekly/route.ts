import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ================== ENV ==================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

// если не задашь — будет "arena"
const SUPABASE_COMPANY_CODE = process.env.SUPABASE_COMPANY_CODE || "arena";

// база за смену (по умолчанию 8000)
const SHIFT_BASE_PAY = Number(process.env.SHIFT_BASE_PAY || 8000);

// ================== TYPES ==================
type Operator = {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
  telegram_chat_id: string | null;
};

type CompanyRow = { id: string };

type IncomeRow = {
  id: string;
  date: string;
  operator_id: string | null;
  company_id: string;
  shift: "day" | "night" | null;
};

type DebtRow = {
  id: number;
  amount: number | null;
  date: string; // week monday
  operator_id: string;
  company_id: string;
  status: string;
};

type AdjKind = "bonus" | "fine" | "advance" | "debt";

type AdjustmentRow = {
  id: number;
  operator_id: string;
  company_id: string;
  date: string;
  amount: number;
  kind: AdjKind;
};

// ================== HELPERS ==================
function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function sbGet<T>(path: string, params: Record<string, string>) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

async function tgSend(chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    }),
  });

  // Telegram иногда отдаёт 200, но ok=false
  const data = await r.json().catch(() => null);
  if (!data || data.ok !== true) {
    throw new Error(`TG fail: ${JSON.stringify(data)?.slice(0, 400)}`);
  }
}

function esc(s: any) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtMoney(n: number) {
  const v = Math.trunc(Number(n || 0));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸";
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function toIsoDateUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Казахстан (Усть-Каменогорск): UTC+5
const KZ_OFFSET_HOURS = 5;

function getPrevWeekRangeKZ(): { dateFrom: string; dateTo: string; weekMonday: string } {
  const nowKZ = new Date(Date.now() + KZ_OFFSET_HOURS * 60 * 60 * 1000);

  // 0=Sun..6=Sat
  const dow = nowKZ.getUTCDay();
  const daysSinceMon = (dow + 6) % 7; // Mon->0 ... Sun->6

  const thisMon = new Date(
    Date.UTC(nowKZ.getUTCFullYear(), nowKZ.getUTCMonth(), nowKZ.getUTCDate())
  );
  thisMon.setUTCDate(thisMon.getUTCDate() - daysSinceMon);

  const prevMon = new Date(thisMon);
  prevMon.setUTCDate(prevMon.getUTCDate() - 7);

  const prevSun = new Date(thisMon);
  prevSun.setUTCDate(prevSun.getUTCDate() - 1);

  return {
    dateFrom: toIsoDateUTC(prevMon),
    dateTo: toIsoDateUTC(prevSun),
    weekMonday: toIsoDateUTC(prevMon), // для debts weekly-row
  };
}

function humanIso(iso: string) {
  // 2026-01-12 -> 12.01.2026
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

async function getCompanyId(): Promise<string> {
  const rows = await sbGet<CompanyRow[]>("companies", {
    select: "id",
    code: `eq.${SUPABASE_COMPANY_CODE}`,
    limit: "1",
  });
  if (!rows?.length) throw new Error(`Company not found by code=${SUPABASE_COMPANY_CODE}`);
  return rows[0].id;
}

async function fetchStaffWithChats(): Promise<Operator[]> {
  const staff = await sbGet<Operator[]>("operators", {
    select: "id,name,role,is_active,telegram_chat_id",
    is_active: "eq.true",
  });

  return staff.filter(
    (o) =>
      (o.role === "admin" || o.role === "worker") &&
      !!o.telegram_chat_id &&
      String(o.telegram_chat_id).trim().length > 0
  );
}

async function countShifts(companyId: string, operatorId: string, dateFrom: string, dateTo: string) {
  const rows = await sbGet<IncomeRow[]>("incomes", {
    select: "id,date,operator_id,company_id,shift",
    company_id: `eq.${companyId}`,
    operator_id: `eq.${operatorId}`,
    date: `gte.${dateFrom}`,
    "date": `lte.${dateTo}`, // да, повтор — Supabase REST понимает последний; поэтому ниже делаем по-другому
  }).catch(() => []);

  // Если твой supabase капризничает из-за двойного ключа date — используем URLSearchParams вручную:
  // но проще: сделаем второй запрос корректно, без дубля:
  // (оставляю правильный вариант ниже, он перекроет rows)
  const url = new URL(`${SUPABASE_URL}/rest/v1/incomes`);
  url.searchParams.set("select", "id,date,shift");
  url.searchParams.set("company_id", `eq.${companyId}`);
  url.searchParams.set("operator_id", `eq.${operatorId}`);
  url.searchParams.set("date", `gte.${dateFrom}`);
  url.searchParams.append("date", `lte.${dateTo}`);

  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase incomes ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as Array<{ id: string; date: string; shift: any }>;

  const shifts = data.filter((x) => x.shift === "day" || x.shift === "night").length;
  return shifts;
}

async function getWeeklyDebtAmount(companyId: string, operatorId: string, weekMonday: string) {
  const rows = await sbGet<DebtRow[]>("debts", {
    select: "id,amount,date,operator_id,company_id,status",
    company_id: `eq.${companyId}`,
    operator_id: `eq.${operatorId}`,
    date: `eq.${weekMonday}`,
    status: "eq.active",
    limit: "1",
  });
  if (!rows?.length) return 0;
  return Number(rows[0].amount || 0);
}

async function getAdjustments(companyId: string, operatorId: string, dateFrom: string, dateTo: string) {
  // date gte/lte делаем так же, через append
  const url = new URL(`${SUPABASE_URL}/rest/v1/operator_salary_adjustments`);
  url.searchParams.set("select", "id,operator_id,company_id,date,amount,kind");
  url.searchParams.set("company_id", `eq.${companyId}`);
  url.searchParams.set("operator_id", `eq.${operatorId}`);
  url.searchParams.set("date", `gte.${dateFrom}`);
  url.searchParams.append("date", `lte.${dateTo}`);

  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`Supabase adjustments ${r.status}: ${await r.text()}`);
  const rows = (await r.json()) as AdjustmentRow[];

  const sums: Record<AdjKind, number> = { bonus: 0, fine: 0, advance: 0, debt: 0 };

  for (const row of rows) {
    const k = row.kind;
    const a = Number(row.amount || 0);
    if (k && sums[k] !== undefined) sums[k] += a;
  }

  return { rows, sums };
}

function buildMessage(args: {
  name: string;
  dateFrom: string;
  dateTo: string;
  shifts: number;
  base: number;
  bonus: number;
  fine: number;
  advance: number;
  debt: number;
  toPay: number;
  adjRows: AdjustmentRow[];
}) {
  const { name, dateFrom, dateTo, shifts, base, bonus, fine, advance, debt, toPay, adjRows } = args;

  const parts: string[] = [];

  // детализация по корректировкам (если есть)
  const detailLines = adjRows
    .slice(0, 20)
    .map((r) => {
      const sign = r.kind === "bonus" ? "+" : "-";
      const label =
        r.kind === "bonus"
          ? "Бонус"
          : r.kind === "fine"
          ? "Штраф"
          : r.kind === "advance"
          ? "Аванс"
          : "Долг";
      return `• ${label}: <b>${sign}${fmtMoney(Math.abs(Number(r.amount || 0)))}</b> <i>(${r.date})</i>`;
    });

  if (detailLines.length) {
    parts.push("📎 <b>Детализация:</b>\n" + detailLines.join("\n"));
  }

  return (
    `📌 <b>Недельная зарплата</b>\n` +
    `👤 <b>${esc(name)}</b>\n` +
    `📅 Период: <b>${humanIso(dateFrom)} — ${humanIso(dateTo)}</b>\n` +
    `------------------\n` +
    `🧾 Смен: <b>${shifts}</b>\n` +
    `💼 База: <b>${fmtMoney(base)}</b>\n` +
    `🎁 Бонусы: <b>+${fmtMoney(bonus)}</b>\n` +
    `⚠️ Штрафы: <b>-${fmtMoney(fine)}</b>\n` +
    `💸 Авансы: <b>-${fmtMoney(advance)}</b>\n` +
    `🔗 Долг (неделя): <b>-${fmtMoney(debt)}</b>\n` +
    `------------------\n` +
    `✅ <b>К выплате: ${fmtMoney(toPay)}</b>\n` +
    (parts.length ? `\n\n${parts.join("\n\n")}` : "")
  );
}

// ================== ROUTE ==================
export async function GET(req: Request) {
  // --- auth ---
  const auth = req.headers.get("authorization") || "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // --- params ---
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // --- period ---
  const { dateFrom, dateTo, weekMonday } = getPrevWeekRangeKZ();

  // --- company ---
  const companyId = await getCompanyId();

  // --- targets ---
  const targets = await fetchStaffWithChats();

  let sent = 0;
  let failed = 0;

  const errors: Array<{ id: string; name: string; error: string }> = [];

  for (const op of targets) {
    try {
      const shifts = await countShifts(companyId, op.id, dateFrom, dateTo);
      const base = shifts * SHIFT_BASE_PAY;

      // долг недели (weekly row)
      const debtWeek = await getWeeklyDebtAmount(companyId, op.id, weekMonday);

      // корректировки
      const { rows: adjRows, sums } = await getAdjustments(companyId, op.id, dateFrom, dateTo);

      // если ты ведёшь долг и в adjustments(kind=debt), и в debts weekly — чтобы не удвоить:
      // оставляю правило: debt = debtsWeekly + adjustments.debt
      const debt = Number(debtWeek || 0) + Number(sums.debt || 0);

      const bonus = Number(sums.bonus || 0);
      const fine = Number(sums.fine || 0);
      const advance = Number(sums.advance || 0);

      const toPay = base + bonus - fine - advance - debt;

      const msg = buildMessage({
        name: op.name,
        dateFrom,
        dateTo,
        shifts,
        base,
        bonus,
        fine,
        advance,
        debt,
        toPay,
        adjRows,
      });

      if (!dryRun) {
        await tgSend(String(op.telegram_chat_id), msg);
        await sleep(350);
      }

      sent++;
    } catch (e: any) {
      failed++;
      errors.push({
        id: op.id,
        name: op.name,
        error: String(e?.message || e).slice(0, 400),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    company_code: SUPABASE_COMPANY_CODE,
    company_id: companyId,
    period: { dateFrom, dateTo, weekMonday },
    total_targets: targets.length,
    sent,
    failed,
    errors,
  });
}
