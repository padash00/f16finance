/**
 * Классификация процессов: что запущено на станции.
 *
 * Главное правило, ради которого файл существует: **отсутствие в списке не
 * означает игру**. Всё неизвестное помечается как кандидат и требует
 * подтверждения через каталог клуба.
 *
 * Обратное было бы удобно и неверно. На игровом компьютере крутятся драйверы,
 * античиты, обновления, антивирус и десяток служб — записав их все в игры, мы
 * получили бы аналитику, где Windows Update играет больше клиентов.
 *
 * В списке — только универсальные факты. «steam.exe это магазин, а не игра»
 * верно для любого клуба на свете, и таким утверждениям место в коде.
 * «cs2.exe это Counter-Strike 2 из вашего каталога» — уже данные конкретного
 * клуба, и они появятся в базе, когда мы увидим реальные имена процессов.
 */

import type { ProcessClassification } from './types'

/** Магазины и лаунчеры: запускают игры, но сами игрой не являются. */
const LAUNCHERS = new Set([
  'steam.exe',
  'steamwebhelper.exe',
  'epicgameslauncher.exe',
  'epicwebhelper.exe',
  'riotclientservices.exe',
  'riotclientux.exe',
  'battle.net.exe',
  'battlenet.exe',
  'galaxyclient.exe',
  'ubisoftconnect.exe',
  'upc.exe',
  'origin.exe',
  'eadesktop.exe',
  'eabackgroundservice.exe',
  'wgc.exe',
])

/** Фоновые программы: работают рядом с игрой, но игрой не являются. */
const BACKGROUND = new Set([
  'discord.exe',
  'discordptb.exe',
  'obs64.exe',
  'obs32.exe',
  'spotify.exe',
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'yandex.exe',
  'opera.exe',
  'telegram.exe',
  'nvidia share.exe',
  'nvcontainer.exe',
  'nvidia web helper.exe',
  'radeonsoftware.exe',
  'msiafterburner.exe',
  'rtss.exe',
])

/** Часть SENET и обвязки клуба. */
const INFRASTRUCTURE = new Set([
  'dashboard.exe',
  'serviceapp.exe',
  'senetshell.exe',
  'shell.exe',
  'senet.exe',
])

/** Системные процессы Windows, которые заведомо не игры. */
const SYSTEM = new Set([
  'explorer.exe',
  'logonui.exe',
  'dwm.exe',
  'csrss.exe',
  'winlogon.exe',
  'services.exe',
  'svchost.exe',
  'lsass.exe',
  'taskhostw.exe',
  'sihost.exe',
  'runtimebroker.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'ctfmon.exe',
  'conhost.exe',
  'powershell.exe',
  'pwsh.exe',
  'cmd.exe',
  'msmpeng.exe',
  'securityhealthservice.exe',
  'wmiprvse.exe',
  'audiodg.exe',
  'fontdrvhost.exe',
  'smss.exe',
  'wininit.exe',
  'spoolsv.exe',
  'system',
  'idle',
])

/**
 * Классифицирует процесс по имени.
 *
 * Путь принимается, но пока не используется: сначала нужно увидеть, приходит
 * ли он вообще и в каком виде. Правила по пути появятся, когда будет что
 * различать — например, две версии одной игры в разных каталогах.
 */
export function classifyProcess(processName: string | null | undefined): ProcessClassification {
  if (!processName) return 'unknown_candidate'

  const name = String(processName).trim().toLowerCase()
  if (!name) return 'unknown_candidate'

  // Имя может прийти с путём — берём последний сегмент.
  const bare = name.split(/[\\/]/).pop() || name

  if (LAUNCHERS.has(bare)) return 'launcher'
  if (BACKGROUND.has(bare)) return 'background'
  if (INFRASTRUCTURE.has(bare)) return 'infrastructure'
  if (SYSTEM.has(bare)) return 'system'

  // Сюда попадает всё остальное — в том числе настоящие игры. Отличить их от
  // неизвестной служебной программы по одному имени нельзя, и притворяться,
  // что можно, значит испортить будущую аналитику молча.
  return 'unknown_candidate'
}

/**
 * Стоит ли вообще показывать процесс как «что запущено».
 *
 * Системное и инфраструктурное прячем: на экране мониторинга «запущен
 * svchost.exe» не несёт смысла. Лаунчеры и фон показываем — они объясняют,
 * почему человек за компьютером, но игры не запустил.
 */
export function isWorthShowing(classification: ProcessClassification): boolean {
  return classification !== 'system' && classification !== 'infrastructure'
}

/** Человеческое название классификации — для экрана. */
export const CLASSIFICATION_LABELS: Record<ProcessClassification, string> = {
  launcher: 'лаунчер',
  background: 'фоновая программа',
  infrastructure: 'служебное SENET',
  system: 'система',
  unknown_candidate: 'возможно игра',
}
