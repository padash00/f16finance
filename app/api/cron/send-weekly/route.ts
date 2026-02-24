import { NextResponse } from "next/server";

export const runtime = "nodejs";

/* ================== ENV ================== */
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

const SHIFT_BASE_PAY = Number(process.env.SHIFT_BASE_PAY || 8000);
const KZ_OFFSET_HOURS = 5;

/* ================== TYPES ================== */
type Operator = {
  id: string;
  name: string;
  role: string;
  telegram_chat_id: string | null;
};

type CompanyRow = { id: string };

type IncomeRow = {
  id: string;
  shift: "day" | "night" | null;
};

type DebtRow = {
  amount: number | null;
};

type AdjustmentRow = {
  id: number;
  date: string;
  amount: number;
  kind: "bonus" | "fine" | "advance" | "debt";
  comment: string | null;
};

/* ================== HELPERS ================== */
function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function sbGet<T>(path: string, params: URLSearchParams) {
  const url = `${SUPABASE_URL}/rest/v1/${path}?${params.toString()}`;
  const r = await fetch(url, { headers: sbHeaders() });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${path} ${r.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function tgSend(chatId: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: "true",
    }),
  });

  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error(`TG: ${JSON.stringify(data)}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(n: number) {
  const v = Math.trunc(Number(n || 0));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸";
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ================== DATE ================== */
function getPrevWeekKZ() {
  const now = new Date(Date.now() + KZ_OFFSET_HOURS * 3600_000);
  const dow = (now.getUTCDay() + 6) % 7;

  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  mon.setUTCDate(mon.getUTCDate() - dow - 7);

  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);

  const iso = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;

  return { from: iso(mon), to: iso(sun), weekMonday: iso(mon) };
}

/* ================== ROUTE ================== */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const { from, to, weekMonday } = getPrevWeekKZ();

  // 1) company_id по коду (чтобы не считать чужие смены)
  const companyCode = process.env.SUPABASE_COMPANY_CODE || "arena";
  const companyRows = await sbGet<CompanyRow[]>(
    "companies",
    new URLSearchParams({ select: "id", code: `eq.${companyCode}`, limit: "1" })
  );
  if (!companyRows.length) {
    return NextResponse.json({ ok: false, error: `company not found: ${companyCode}` }, { status: 500 });
  }
  const companyId = companyRows[0].id;

  // 2) операторы
  const operators = await sbGet<Operator[]>(
    "operators",
    new URLSearchParams({
      select: "id,name,role,telegram_chat_id",
      is_active: "eq.true",
    })
  );

  const targets = operators.filter(
    (o) => (o.role === "admin" || o.role === "worker") && o.telegram_chat_id
  );

  let sent = 0;
  let failed = 0;
  const errors: Array<{ name: string; error: string }> = [];

  for (const op of targets) {
    try {
      // --- SHIFTS (incomes) ---
      const incomeParams = new URLSearchParams();
      incomeParams.set("select", "id,shift");
      incomeParams.set("company_id", `eq.${companyId}`);
      incomeParams.set("operator_id", `eq.${op.id}`);
      incomeParams.append("date", `gte.${from}`);
      incomeParams.append("date", `lte.${to}`);

      const shifts = await sbGet<IncomeRow[]>("incomes", incomeParams);
      const shiftCount = shifts.filter((s) => s.shift === "day" || s.shift === "night").length;
      const base = shiftCount * SHIFT_BASE_PAY;

      // --- WEEKLY DEBT ---
      const debtParams = new URLSearchParams();
      debtParams.set("select", "amount");
      debtParams.set("company_id", `eq.${companyId}`);
      debtParams.set("operator_id", `eq.${op.id}`);
      debtParams.set("status", "eq.active");
      debtParams.set("date", `eq.${weekMonday}`);
      debtParams.set("limit", "1");

      const debtRow = await sbGet<DebtRow[]>("debts", debtParams);
      const weeklyDebt = Number(debtRow?.[0]?.amount || 0);

      // --- ADJUSTMENTS ---
      const adjParams = new URLSearchParams();
      adjParams.set("select", "id,date,amount,kind,comment");
      adjParams.set("operator_id", `eq.${op.id}`);
      adjParams.append("date", `gte.${from}`);
      adjParams.append("date", `lte.${to}`);

      const adj = await sbGet<AdjustmentRow[]>("operator_salary_adjustments", adjParams);

      const sum = { bonus: 0, fine: 0, advance: 0, debt: 0 };
      for (const a of adj) sum[a.kind] += Number(a.amount || 0);

      const totalDebt = weeklyDebt + sum.debt;
      const toPay = base + sum.bonus - sum.fine - sum.advance - totalDebt;

      const msg =
        `📌 <b>Недельная зарплата</b>\n` +
        `👤 <b>${esc(op.name)}</b>\n` +
        `📅 ${from} — ${to}\n` +
        `------------------\n` +
        `🧾 Смен: ${shiftCount}\n` +
        `💼 База: ${fmt(base)}\n` +
        `🎁 Бонусы: +${fmt(sum.bonus)}\n` +
        `⚠️ Штрафы: -${fmt(sum.fine)}\n` +
        `💸 Авансы: -${fmt(sum.advance)}\n` +
        `🔗 Долг: -${fmt(totalDebt)}\n` +
        `------------------\n` +
        `✅ <b>К выплате: ${fmt(toPay)}</b>`;

      if (!dryRun) {
        await tgSend(String(op.telegram_chat_id), msg);
        await sleep(350);
      }

      sent++;
    } catch (e: any) {
      failed++;
      errors.push({ name: op.name, error: String(e?.message || e).slice(0, 300) });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    company_code: process.env.SUPABASE_COMPANY_CODE || "arena",
    company_id: companyId,
    period: { from, to, weekMonday },
    total: targets.length,
    sent,
    failed,
    errors,
  });
}
