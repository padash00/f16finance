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

type IncomeRow = {
  id: string;
  date: string;
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
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
}

async function tgSend(chatId: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });

  const data = await r.json();
  if (!data.ok) throw new Error(JSON.stringify(data));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fmt(n: number) {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸";
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

  return {
    from: iso(mon),
    to: iso(sun),
    weekMonday: iso(mon),
  };
}

/* ================== ROUTE ================== */
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const { from, to, weekMonday } = getPrevWeekKZ();

  /* --- OPERATORS --- */
  const operators = await sbGet<Operator[]>(
    "operators",
    new URLSearchParams({
      select: "id,name,role,telegram_chat_id",
      is_active: "eq.true",
    })
  );

  const targets = operators.filter(
    (o) =>
      (o.role === "admin" || o.role === "worker") &&
      o.telegram_chat_id
  );

  let sent = 0;
  let failed = 0;

  for (const op of targets) {
    try {
      /* --- SHIFTS --- */
      const shifts = await sbGet<IncomeRow[]>(
        "incomes",
        new URLSearchParams({
          select: "id,shift",
          operator_id: `eq.${op.id}`,
          date: `gte.${from}`,
          "date.lte": to,
        })
      );

      const shiftCount = shifts.filter((s) => s.shift).length;
      const base = shiftCount * SHIFT_BASE_PAY;

      /* --- WEEKLY DEBT --- */
      const debtRow = await sbGet<DebtRow[]>(
        "debts",
        new URLSearchParams({
          select: "amount",
          operator_id: `eq.${op.id}`,
          date: `eq.${weekMonday}`,
          status: "eq.active",
          limit: "1",
        })
      );

      const weeklyDebt = Number(debtRow?.[0]?.amount || 0);

      /* --- ADJUSTMENTS --- */
      const adj = await sbGet<AdjustmentRow[]>(
        "operator_salary_adjustments",
        new URLSearchParams({
          select: "id,date,amount,kind,comment",
          operator_id: `eq.${op.id}`,
          date: `gte.${from}`,
          "date.lte": to,
        })
      );

      const sum = { bonus: 0, fine: 0, advance: 0, debt: 0 };
      adj.forEach((a) => (sum[a.kind] += Number(a.amount || 0)));

      const toPay =
        base +
        sum.bonus -
        sum.fine -
        sum.advance -
        weeklyDebt -
        sum.debt;

      /* --- MESSAGE --- */
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
        `🔗 Долг: -${fmt(weeklyDebt + sum.debt)}\n` +
        `------------------\n` +
        `✅ <b>К выплате: ${fmt(toPay)}</b>`;

      if (!dryRun) {
        await tgSend(op.telegram_chat_id!, msg);
        await sleep(350);
      }

      sent++;
    } catch (e) {
      failed++;
      console.error(op.name, e);
    }
  }

  return NextResponse.json({
    ok: true,
    period: { from, to },
    sent,
    failed,
    total: targets.length,
  });
}
