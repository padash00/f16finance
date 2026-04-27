'use client'

export function ReportsPageSkeleton() {
  return (
    <div className="app-page-ultra max-w-[1800px] space-y-6 animate-pulse" aria-hidden>
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/10 to-fuchsia-600/10 p-8">
        <div className="flex flex-col lg:flex-row gap-6 justify-between">
          <div className="flex gap-4">
            <div className="h-14 w-14 rounded-2xl bg-white/10" />
            <div className="space-y-2">
              <div className="h-8 w-64 rounded-lg bg-white/10" />
              <div className="h-4 w-48 rounded bg-white/5" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="h-10 w-40 rounded-xl bg-white/10" />
            <div className="h-10 w-10 rounded-xl bg-white/10" />
            <div className="h-10 w-10 rounded-xl bg-white/10" />
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-white/5 bg-gray-900/40 p-4 space-y-3">
        <div className="h-4 w-32 rounded bg-white/10" />
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 w-28 rounded-lg bg-white/5" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-white/5 bg-gray-900/40 p-5 space-y-3">
            <div className="h-3 w-24 rounded bg-white/10" />
            <div className="h-8 w-36 rounded-lg bg-white/10" />
            <div className="h-3 w-20 rounded bg-white/5" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-white/5 bg-gray-900/40 h-72" />
    </div>
  )
}
