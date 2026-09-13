export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      expenses: {
        Row: {
          id: string
          created_at: string
          user_id: string
          amount: number
          merchant: string
          category: string
          status: string
          receipt_url: string
          audit_summary: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          amount: number
          merchant: string
          category: string
          status?: string
          receipt_url: string
          audit_summary?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          user_id?: string
          amount?: number
          merchant?: string
          category?: string
          status?: string
          receipt_url?: string
          audit_summary?: string | null
        }
      }
    }
  }
}
