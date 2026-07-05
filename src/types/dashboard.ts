import type { LucideIcon } from "lucide-react";

export type PAccount = {
  id: string; account_id: string; name: string | null; official_name: string | null;
  mask: string | null; type: string | null; subtype: string | null;
  current_balance: number | null; available_balance: number | null;
  iso_currency_code: string | null;
};

export type PTxn = {
  id: string; account_id: string; item_id: string | null; transaction_id: string | null;
  amount: number; date: string; authorized_date: string | null;
  name: string | null; merchant_name: string | null; category: string[] | null;
  pending: boolean | null; payment_channel: string | null;
};

export type PItem = {
  id: string; item_id?: string;
  institution_id: string | null; institution_name: string | null;
  status?: string | null; cursor?: string | null;
};

export type AccountMeta = {
  nickname?: string; apr?: number;
  promoApr?: number; promoEndDate?: string; customUrl?: string;
};

export type CreditDetail = {
  account_id: string;
  last_statement_balance: number | null; last_payment_amount: number | null;
  minimum_payment_amount: number | null; next_payment_due_date: string | null;
  is_overdue: boolean | null; last_payment_date: string | null;
  apr?: number | null;
};

export type ActionItem = {
  id: string; priority: "urgent" | "soon" | "info";
  title: string; detail: string; cta: string;
  icon: LucideIcon; reviewCategory?: string;
};

export type AIInsight = {
  id: string; severity: "high" | "medium" | "low";
  category: string; title: string; what: string; why: string;
  action: string; impact: string; impactValue: number;
};

export type Bucket = "cash" | "credit" | "loan" | "investment" | "other";
export type Period = "1W" | "1M" | "3M" | "1Y" | "ALL";

export interface PeriodState { granularity: "day" | "week" | "month" | "year"; offset: number; }
