import { redirect } from 'next/navigation'

export default function ExpensesAddRedirect() {
  redirect('/expenses/new')
}
