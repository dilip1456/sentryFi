export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type UserSettingsJsonFields = {
  budgets: Json
  account_roles: Json
  cat_overrides: Json
  cat_rules: Json
  smart_rules: Json
  custom_cats: Json
  name_overrides: Json
  name_rules: Json
  manual_income: Json
  manual_internal: Json
  manual_external: Json
  dismissed_insights: Json
  dismissed_actions: Json
  dismissed_recurring: Json
  recurring_dismissals: Json
  overage_funding_prefs: Json
  planned_transfers: Json
  savings_goals: Json
  panel_order: Json
  account_meta: Json
  benefits_used: Json
  money_map_feedback: Json
  txn_tags: Json
  txn_notes: Json
  recurring_overrides: Json
  txn_splits: Json
  recurring_groups: Json
  card_autopay_from: Json
  financial_picture: Json
}

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_preferences: {
        Row: {
          id: string
          user_id: string
          email_enabled: boolean
          push_enabled: boolean
          email: string | null
          budget_pct: number
          low_balance: number
          payment_days: number
          weekly_summary: boolean
          alert_budget_threshold: boolean
          alert_low_balance: boolean
          alert_payment_due: boolean
          alert_large_txn: boolean
          alert_deposit: boolean
          alert_refund: boolean
          alert_transfer: boolean
          alert_cc_payment: boolean
          alert_insight: boolean
          alert_price_change: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          email_enabled?: boolean
          push_enabled?: boolean
          email?: string | null
          budget_pct?: number
          low_balance?: number
          payment_days?: number
          weekly_summary?: boolean
          alert_budget_threshold?: boolean
          alert_low_balance?: boolean
          alert_payment_due?: boolean
          alert_large_txn?: boolean
          alert_deposit?: boolean
          alert_refund?: boolean
          alert_transfer?: boolean
          alert_cc_payment?: boolean
          alert_insight?: boolean
          alert_price_change?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          email_enabled?: boolean
          push_enabled?: boolean
          email?: string | null
          budget_pct?: number
          low_balance?: number
          payment_days?: number
          weekly_summary?: boolean
          alert_budget_threshold?: boolean
          alert_low_balance?: boolean
          alert_payment_due?: boolean
          alert_large_txn?: boolean
          alert_deposit?: boolean
          alert_refund?: boolean
          alert_transfer?: boolean
          alert_cc_payment?: boolean
          alert_insight?: boolean
          alert_price_change?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      cover_actions: {
        Row: {
          action_type: string
          amount: number
          created_at: string
          from_id: string | null
          id: string
          month: string
          note: string | null
          to_id: string
          user_id: string
        }
        Insert: {
          action_type: string
          amount?: number
          created_at?: string
          from_id?: string | null
          id?: string
          month: string
          note?: string | null
          to_id: string
          user_id: string
        }
        Update: {
          action_type?: string
          amount?: number
          created_at?: string
          from_id?: string | null
          id?: string
          month?: string
          note?: string | null
          to_id?: string
          user_id?: string
        }
        Relationships: []
      }
      manual_accounts: {
        Row: {
          created_at: string
          current_balance: number | null
          id: string
          institution_name: string | null
          interest_rate: number | null
          loan_start_date: string | null
          loan_term_years: number | null
          monthly_payment: number | null
          name: string
          notes: string | null
          original_loan_amount: number | null
          property_address: string | null
          property_value: number | null
          role: string
          role_label: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_balance?: number | null
          id?: string
          institution_name?: string | null
          interest_rate?: number | null
          loan_start_date?: string | null
          loan_term_years?: number | null
          monthly_payment?: number | null
          name: string
          notes?: string | null
          original_loan_amount?: number | null
          property_address?: string | null
          property_value?: number | null
          role?: string
          role_label?: string | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_balance?: number | null
          id?: string
          institution_name?: string | null
          interest_rate?: number | null
          loan_start_date?: string | null
          loan_term_years?: number | null
          monthly_payment?: number | null
          name?: string
          notes?: string | null
          original_loan_amount?: number | null
          property_address?: string | null
          property_value?: number | null
          role?: string
          role_label?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      obligations: {
        Row: {
          active: boolean
          amount: number
          category: string | null
          created_at: string
          funding_account_id: string | null
          goal_deadline: string | null
          goal_target: number | null
          id: string
          merchant_hint: string | null
          name: string
          sort_order: number
          type: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount?: number
          category?: string | null
          created_at?: string
          funding_account_id?: string | null
          goal_deadline?: string | null
          goal_target?: number | null
          id?: string
          merchant_hint?: string | null
          name: string
          sort_order?: number
          type?: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string | null
          created_at?: string
          funding_account_id?: string | null
          goal_deadline?: string | null
          goal_target?: number | null
          id?: string
          merchant_hint?: string | null
          name?: string
          sort_order?: number
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      plaid_accounts: {
        Row: {
          account_id: string
          available_balance: number | null
          created_at: string
          credit_limit: number | null
          current_balance: number | null
          id: string
          iso_currency_code: string | null
          item_id: string
          mask: string | null
          name: string | null
          official_name: string | null
          subtype: string | null
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          available_balance?: number | null
          created_at?: string
          credit_limit?: number | null
          current_balance?: number | null
          id?: string
          iso_currency_code?: string | null
          item_id: string
          mask?: string | null
          name?: string | null
          official_name?: string | null
          subtype?: string | null
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          available_balance?: number | null
          created_at?: string
          credit_limit?: number | null
          current_balance?: number | null
          id?: string
          iso_currency_code?: string | null
          item_id?: string
          mask?: string | null
          name?: string | null
          official_name?: string | null
          subtype?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_accounts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          access_token: string
          created_at: string
          cursor: string | null
          error_at: string | null
          error_code: string | null
          id: string
          institution_id: string | null
          institution_name: string | null
          item_id: string
          last_synced_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          cursor?: string | null
          error_at?: string | null
          error_code?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id: string
          last_synced_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          cursor?: string | null
          error_at?: string | null
          error_code?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id?: string
          last_synced_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plaid_loan_details: {
        Row: {
          account_id: string
          escrow_balance: number | null
          interest_rate: number | null
          is_overdue: boolean | null
          kind: string
          last_payment_amount: number | null
          last_payment_date: string | null
          minimum_payment_amount: number | null
          next_monthly_payment: number | null
          next_payment_due_date: string | null
          origination_principal: number | null
          outstanding_principal: number | null
          updated_at: string
          user_id: string
          ytd_interest_paid: number | null
          ytd_principal_paid: number | null
        }
        Insert: {
          account_id: string
          escrow_balance?: number | null
          interest_rate?: number | null
          is_overdue?: boolean | null
          kind: string
          last_payment_amount?: number | null
          last_payment_date?: string | null
          minimum_payment_amount?: number | null
          next_monthly_payment?: number | null
          next_payment_due_date?: string | null
          origination_principal?: number | null
          outstanding_principal?: number | null
          updated_at?: string
          user_id: string
          ytd_interest_paid?: number | null
          ytd_principal_paid?: number | null
        }
        Update: {
          account_id?: string
          escrow_balance?: number | null
          interest_rate?: number | null
          is_overdue?: boolean | null
          kind?: string
          last_payment_amount?: number | null
          last_payment_date?: string | null
          minimum_payment_amount?: number | null
          next_monthly_payment?: number | null
          next_payment_due_date?: string | null
          origination_principal?: number | null
          outstanding_principal?: number | null
          updated_at?: string
          user_id?: string
          ytd_interest_paid?: number | null
          ytd_principal_paid?: number | null
        }
        Relationships: []
      }
      plaid_transactions: {
        Row: {
          account_id: string
          amount: number
          authorized_date: string | null
          category: string[] | null
          created_at: string
          date: string
          id: string
          iso_currency_code: string | null
          item_id: string
          logo_url: string | null
          merchant_name: string | null
          name: string | null
          plaid_category: string[] | null
          payment_channel: string | null
          pending: boolean | null
          transaction_id: string
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          account_id: string
          amount: number
          authorized_date?: string | null
          category?: string[] | null
          created_at?: string
          date: string
          id?: string
          iso_currency_code?: string | null
          item_id: string
          logo_url?: string | null
          merchant_name?: string | null
          name?: string | null
          plaid_category?: string[] | null
          payment_channel?: string | null
          pending?: boolean | null
          transaction_id: string
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          authorized_date?: string | null
          category?: string[] | null
          created_at?: string
          date?: string
          id?: string
          iso_currency_code?: string | null
          item_id?: string
          logo_url?: string | null
          merchant_name?: string | null
          name?: string | null
          plaid_category?: string[] | null
          payment_channel?: string | null
          pending?: boolean | null
          transaction_id?: string
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plaid_transactions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          disabled: boolean
          display_name: string | null
          id: string
          phone: string | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          disabled?: boolean
          display_name?: string | null
          id?: string
          phone?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          disabled?: boolean
          display_name?: string | null
          id?: string
          phone?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscribers: {
        Row: {
          created_at: string
          current_period_end: string | null
          email: string
          id: string
          plan: Database["public"]["Enums"]["plan_tier"]
          status: string
          stripe_customer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          email: string
          id?: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          email?: string
          id?: string
          plan?: Database["public"]["Enums"]["plan_tier"]
          status?: string
          stripe_customer_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: UserSettingsJsonFields & {
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: Partial<UserSettingsJsonFields> & {
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: Partial<UserSettingsJsonFields> & {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      plan_tier: "free" | "pro" | "premium"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      plan_tier: ["free", "pro", "premium"],
    },
  },
} as const
