import { redirect } from 'next/navigation'

/** Страница переехала в раздел «Регламенты точки». Старый адрес живёт ради закладок и ссылок в письмах. */
export default function LegacyRedirect() {
  redirect('/regulations')
}
