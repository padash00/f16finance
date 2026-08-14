import RegulationsTabs from './RegulationsTabs'

/**
 * Раздел «Регламенты точки»: правила и чек-листы, экзамены, настройка каркаса.
 * Общая полоса вкладок держит их вместе — страницы сохраняют свои заголовки.
 */
export default function RegulationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RegulationsTabs />
      {children}
    </>
  )
}
