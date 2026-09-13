export type ExpenseStatus = 'pending' | 'compliant' | 'flagged' | 'rejected';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'employee' | 'auditor' | 'admin';
  created_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  merchant: string;
  category: string;
  date: string;
  receipt_url: string;
  status: ExpenseStatus;
  audit_summary: string | null;
  created_at: string;
}

export interface Policy {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  expense_id: string;
  policy_id: string | null;
  result: 'compliant' | 'flagged' | 'rejected';
  reason: string;
  created_at: string;
}
