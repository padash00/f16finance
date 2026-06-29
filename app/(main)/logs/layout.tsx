import type { Metadata } from 'next'

// Страница /logs — клиентский компонент и не может экспортировать metadata сама.
// Этот серверный layout задаёт заголовок вкладки через нативную систему Next
// (корневой template превратит его в «Журнал действий | Orda Control»).
export const metadata: Metadata = {
  title: 'Журнал действий',
}

export default function LogsLayout({ children }: { children: React.ReactNode }) {
  return children
}
