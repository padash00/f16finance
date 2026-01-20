import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ================== ENV ==================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const CRON_SECRET = process.env.CRON_SECRET!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

type Operator = {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
  telegram_chat_id: string | null;
};

// ============== HELPERS ==============
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

  const data = await r.json().catch(() => null);

  // ВАЖНО: Telegram иногда возвращает 200, но ok=false
  if (!data || data.ok !== true) {
    const err = JSON.stringify(data)?.slice(0, 400);
    throw new Error(`TG fail: ${err}`);
  }
}

function esc(s: any) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

// Казахстан (Усть-Каменогорск): UTC+5 (без DST)
const KZ_OFFSET_HOURS = 5;

// Возвращает прошлую неделю Пн–Вс по KZ
function getPrevWeekRangeKZ(): { dateFrom: string; dateTo: string } {
  // "KZ-now" (но как Date в UTC)
  const nowKZ = new Date(Date.now() + KZ_OFFSET_HOURS * 60 * 60 * 1000);

  // 0=Sun..6=Sat в KZ-времени
  const dow = nowKZ.getUTCDay();

  // сколько дней отнять до понедельника текущей недели
  // Mon->0, Tue->1, ..., Sun->6
  const daysSinceMon = (dow + 6) % 7;

  // понедельник текущей недели (KZ)
  const thisMon = new Date(
    Date.UTC(nowKZ.getUTCFullYear(), nowKZ.getUTCMonth(), nowKZ.getUTCDate())
  );
  thisMon.setUTCDate(thisMon.getUTCDate() - daysSinceMon);

  // прошлая неделя
  const prevMon = new Date(thisMon);
  prevMon.setUTCDate(prevMon.getUTCDate() - 7);

  const prevSun = new Date(thisMon);
  prevSun.setUTCDate(prevSun.getUTCDate() - 1);

  return { dateFrom: toIsoDateUTC(prevMon), dateTo: toIsoDateUTC(prevSun) };
}

// ============== ROUTE ==============
export async function GET(req: Request) {
  // ---- auth ----
  const auth = req.headers.get("authorization") || "";
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ---- params ----
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  // ---- period: prev week (Mon-Sun) KZ ----
  const { dateFrom, dateTo } = getPrevWeekRangeKZ();

  // ---- fetch staff ----
  const staff = await sbGet<Operator[]>("operators", {
    select: "id,name,role,is_active,telegram_chat_id",
    is_active: "eq.true",
  });

  const targets = staff.filter(
    (o) =>
      (o.role === "admin" || o.role === "worker") &&
      !!o.telegram_chat_id &&
      String(o.telegram_chat_id).trim().length > 0
  );

  const skippedNoChat = staff
    .filter((o) => (o.role === "admin" || o.role === "worker") && !o.telegram_chat_id)
    .map((o) => ({ id: o.id, name: o.name }));

  let sent = 0;
  let failed = 0;
  const errors: Array<{ id: string; name: string; error: string }> = [];

  for (const op of targets) {
    try {
      // TODO: сюда вставишь реальный расчёт (смены/бонус/штраф/аванс/долг)
      const msg =
        `📌 <b>Недельный отчёт</b>\n` +
        `👤 <b>${esc(op.name)}</b>\n` +
        `📅 Период: <b>${dateFrom} — ${dateTo}</b>\n` +
        `------------------\n` +
        `✅ Всё ок. (сюда вставим: смены, бонусы, штрафы, аванс, долг)\n`;

      if (!dryRun) {
        await tgSend(String(op.telegram_chat_id), msg);
        await sleep(350); // антифлуд
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
    period: { dateFrom, dateTo },
    total_targets: targets.length,
    sent,
    failed,
    skipped_no_chat_id: skippedNoChat,
    errors,
  });
}
