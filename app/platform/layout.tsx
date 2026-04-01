import { redirect } from 'next/navigation'

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  void children
  redirect('/dashboard')
}
