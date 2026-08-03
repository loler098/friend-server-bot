export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      bot_gateway_status: {
        Row: {
          connected: boolean | null
          id: number
          last_heartbeat_at: string | null
          session_id: string | null
        }
        Insert: {
          connected?: boolean | null
          id?: number
          last_heartbeat_at?: string | null
          session_id?: string | null
        }
        Update: {
          connected?: boolean | null
          id?: number
          last_heartbeat_at?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      deposit_addresses: {
        Row: {
          active: boolean
          address: string
          coin: string
          created_at: string
          id: string
          min_confirmations: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          address: string
          coin: string
          created_at?: string
          id?: string
          min_confirmations?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          coin?: string
          created_at?: string
          id?: string
          min_confirmations?: number
          updated_at?: string
        }
        Relationships: []
      }
      deposits: {
        Row: {
          address: string
          coin: string
          confirmations: number
          created_at: string
          credited: boolean
          crypto_amount: number
          discord_user_id: string | null
          eur_cents: number
          id: string
          status: string
          tx_hash: string
          updated_at: string
        }
        Insert: {
          address: string
          coin: string
          confirmations?: number
          created_at?: string
          credited?: boolean
          crypto_amount?: number
          discord_user_id?: string | null
          eur_cents?: number
          id?: string
          status?: string
          tx_hash: string
          updated_at?: string
        }
        Update: {
          address?: string
          coin?: string
          confirmations?: number
          created_at?: string
          credited?: boolean
          crypto_amount?: number
          discord_user_id?: string | null
          eur_cents?: number
          id?: string
          status?: string
          tx_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_sessions: {
        Row: {
          bet_cents: number
          created_at: string
          discord_user_id: string
          discord_username: string
          id: string
          kind: string
          state: Json
          status: string
          updated_at: string
        }
        Insert: {
          bet_cents: number
          created_at?: string
          discord_user_id: string
          discord_username: string
          id?: string
          kind: string
          state?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          bet_cents?: number
          created_at?: string
          discord_user_id?: string
          discord_username?: string
          id?: string
          kind?: string
          state?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_balances: {
        Row: {
          balance_cents: number
          created_at: string | null
          daily_claimed_at: string | null
          deposit_tag: number
          discord_user_id: string
          discord_username: string
          id: string
          updated_at: string | null
        }
        Insert: {
          balance_cents?: number
          created_at?: string | null
          daily_claimed_at?: string | null
          deposit_tag?: number
          discord_user_id: string
          discord_username: string
          id?: string
          updated_at?: string | null
        }
        Update: {
          balance_cents?: number
          created_at?: string | null
          daily_claimed_at?: string | null
          deposit_tag?: number
          discord_user_id?: string
          discord_username?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          address: string
          coin: string
          created_at: string
          discord_user_id: string
          discord_username: string
          eur_cents: number
          fee_cents: number
          id: string
          note: string | null
          released_by: string | null
          status: string
          tx_hash: string | null
          updated_at: string
        }
        Insert: {
          address: string
          coin: string
          created_at?: string
          discord_user_id: string
          discord_username: string
          eur_cents: number
          fee_cents?: number
          id?: string
          note?: string | null
          released_by?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          coin?: string
          created_at?: string
          discord_user_id?: string
          discord_username?: string
          eur_cents?: number
          fee_cents?: number
          id?: string
          note?: string | null
          released_by?: string | null
          status?: string
          tx_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_balance: {
        Args: { _delta_cents: number; _discord_user_id: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
