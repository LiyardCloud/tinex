import { Account, ScheduledTransaction, Transaction } from '@/core/models';

export interface AccountBalanceBreakdown {
  /** Balance as stored: includes every transaction, future-dated ones too */
  stored: number;
  /** Real balance right now: future-dated transactions are not applied */
  current: number;
  /** Stored balance minus scheduled expenses due this month */
  available: number;
  /** Net effect of future-dated transactions (income +, expense −) */
  futureImpact: number;
}

const toDate = (value: Date | { toDate: () => Date }): Date =>
  value instanceof Date ? value : value.toDate();

/**
 * Split an account balance into current and available parts.
 * Transactions change the stored balance immediately with their raw amount, whatever their date
 * (see TransactionRepository.updateAccountBalance), so future-dated ones are subtracted back here.
 */
export function getAccountBalanceBreakdown(
  account: Account,
  transactions: Transaction[],
  scheduledTransactions: ScheduledTransaction[] = [],
  now: Date = new Date()
): AccountBalanceBreakdown {
  let futureImpact = 0;
  for (const t of transactions) {
    if (t.accountId !== account.id || toDate(t.date) <= now) continue;
    if (t.type === 'income') futureImpact += t.amount;
    else if (t.type === 'expense') futureImpact -= t.amount;
  }

  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  let scheduledExpenses = 0;
  for (const s of scheduledTransactions) {
    if (s.accountId !== account.id || s.type !== 'expense') continue;
    if (s.nextDate >= now && s.nextDate <= monthEnd) scheduledExpenses += s.amount;
  }

  return {
    stored: account.balance,
    current: account.balance - futureImpact,
    available: account.balance - scheduledExpenses,
    futureImpact,
  };
}
