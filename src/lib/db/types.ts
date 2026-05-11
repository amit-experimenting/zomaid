// Hand-maintained Supabase types. Regenerate with `supabase gen types typescript`
// once the schema stabilizes; for now we curate exactly what we use.

export type Role = "owner" | "family_member" | "maid";
export type Privilege = "full" | "meal_modify" | "view_only";
export type MembershipStatus = "active" | "pending" | "removed";
export type IntendedRole = Role;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          clerk_user_id: string;
          email: string;
          display_name: string;
          locale: string;
          timezone: string;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          clerk_user_id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      households: {
        Row: {
          id: string;
          name: string;
          address_line: string | null;
          postal_code: string | null;
          created_by_profile_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          created_by_profile_id: string;
          address_line?: string | null;
          postal_code?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["households"]["Row"]>;
        Relationships: [];
      };
      household_memberships: {
        Row: {
          id: string;
          household_id: string;
          profile_id: string;
          role: Role;
          privilege: Privilege;
          status: MembershipStatus;
          joined_at: string;
          removed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          household_id: string;
          profile_id: string;
          role: Role;
          privilege?: Privilege;
          status?: MembershipStatus;
        };
        Update: Partial<Database["public"]["Tables"]["household_memberships"]["Row"]>;
        Relationships: [];
      };
      invites: {
        Row: {
          id: string;
          household_id: string;
          invited_by_profile_id: string;
          intended_role: Role;
          intended_privilege: Privilege | null;
          code: string;
          token: string;
          expires_at: string;
          consumed_at: string | null;
          consumed_by_profile_id: string | null;
          created_at: string;
        };
        Insert: {
          household_id: string;
          invited_by_profile_id: string;
          intended_role: Role;
          intended_privilege?: Privilege | null;
          code: string;
          token: string;
          expires_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["invites"]["Row"]>;
        Relationships: [];
      };
      recipes: {
        Row: {
          id: string;
          household_id: string | null;
          parent_recipe_id: string | null;
          name: string;
          slot: "breakfast" | "lunch" | "snacks" | "dinner";
          photo_path: string | null;
          prep_time_minutes: number | null;
          notes: string | null;
          created_by_profile_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          household_id?: string | null;
          parent_recipe_id?: string | null;
          name: string;
          slot: "breakfast" | "lunch" | "snacks" | "dinner";
          photo_path?: string | null;
          prep_time_minutes?: number | null;
          notes?: string | null;
          created_by_profile_id?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["recipes"]["Insert"]>;
        Relationships: [];
      };
      recipe_ingredients: {
        Row: {
          id: string;
          recipe_id: string;
          position: number;
          item_name: string;
          quantity: string | null;
          unit: string | null;
        };
        Insert: {
          id?: string;
          recipe_id: string;
          position: number;
          item_name: string;
          quantity?: number | string | null;
          unit?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["recipe_ingredients"]["Insert"]>;
        Relationships: [];
      };
      recipe_steps: {
        Row: {
          id: string;
          recipe_id: string;
          position: number;
          instruction: string;
        };
        Insert: {
          id?: string;
          recipe_id: string;
          position: number;
          instruction: string;
        };
        Update: Partial<Database["public"]["Tables"]["recipe_steps"]["Insert"]>;
        Relationships: [];
      };
      household_recipe_hides: {
        Row: {
          household_id: string;
          recipe_id: string;
          hidden_at: string;
          hidden_by_profile_id: string | null;
        };
        Insert: {
          household_id: string;
          recipe_id: string;
          hidden_at?: string;
          hidden_by_profile_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["household_recipe_hides"]["Insert"]>;
        Relationships: [];
      };
      meal_plans: {
        Row: {
          id: string;
          household_id: string;
          plan_date: string;
          slot: "breakfast" | "lunch" | "snacks" | "dinner";
          recipe_id: string | null;
          set_by_profile_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          plan_date: string;
          slot: "breakfast" | "lunch" | "snacks" | "dinner";
          recipe_id?: string | null;
          set_by_profile_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["meal_plans"]["Insert"]>;
        Relationships: [];
      };
      shopping_list_items: {
        Row: {
          id: string;
          household_id: string;
          item_name: string;
          quantity: number | null;
          unit: string | null;
          notes: string | null;
          bought_at: string | null;
          bought_by_profile_id: string | null;
          created_by_profile_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          item_name: string;
          quantity?: number | null;
          unit?: string | null;
          notes?: string | null;
          bought_at?: string | null;
          bought_by_profile_id?: string | null;
          created_by_profile_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["shopping_list_items"]["Insert"]>;
        Relationships: [];
      };
      bills: {
        Row: {
          id: string;
          household_id: string;
          uploaded_by_profile_id: string | null;
          status: "pending" | "processing" | "processed" | "failed";
          status_reason: string | null;
          bill_date: string | null;
          store_name: string | null;
          total_amount: number | null;
          currency: string;
          image_storage_path: string;
          github_issue_number: number | null;
          github_issue_url: string | null;
          created_at: string;
          updated_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          household_id: string;
          uploaded_by_profile_id?: string | null;
          status?: "pending" | "processing" | "processed" | "failed";
          status_reason?: string | null;
          bill_date?: string | null;
          store_name?: string | null;
          total_amount?: number | null;
          currency?: string;
          image_storage_path: string;
          github_issue_number?: number | null;
          github_issue_url?: string | null;
          created_at?: string;
          updated_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["bills"]["Insert"]>;
        Relationships: [];
      };
      bill_line_items: {
        Row: {
          id: string;
          bill_id: string;
          position: number;
          item_name: string;
          quantity: number | null;
          unit: string | null;
          unit_price: number | null;
          line_total: number | null;
          matched_shopping_item_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          bill_id: string;
          position: number;
          item_name: string;
          quantity?: number | null;
          unit?: string | null;
          unit_price?: number | null;
          line_total?: number | null;
          matched_shopping_item_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bill_line_items"]["Insert"]>;
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          household_id: string;
          title: string;
          notes: string | null;
          assigned_to_profile_id: string | null;
          recurrence_frequency: "daily" | "weekly" | "monthly";
          recurrence_interval: number;
          recurrence_byweekday: number[] | null;
          recurrence_bymonthday: number | null;
          recurrence_starts_on: string;
          recurrence_ends_on: string | null;
          due_time: string;
          created_by_profile_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          household_id: string;
          title: string;
          notes?: string | null;
          assigned_to_profile_id?: string | null;
          recurrence_frequency: "daily" | "weekly" | "monthly";
          recurrence_interval?: number;
          recurrence_byweekday?: number[] | null;
          recurrence_bymonthday?: number | null;
          recurrence_starts_on?: string;
          recurrence_ends_on?: string | null;
          due_time?: string;
          created_by_profile_id?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Insert"]>;
        Relationships: [];
      };
      task_occurrences: {
        Row: {
          id: string;
          task_id: string;
          due_at: string;
          status: "pending" | "done" | "skipped";
          completed_by_profile_id: string | null;
          completed_at: string | null;
          notified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          due_at: string;
          status?: "pending" | "done" | "skipped";
          completed_by_profile_id?: string | null;
          completed_at?: string | null;
          notified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["task_occurrences"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          endpoint: string;
          p256dh_key: string;
          auth_key: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string | null;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          endpoint: string;
          p256dh_key: string;
          auth_key: string;
          user_agent?: string | null;
          created_at?: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      // No views yet.
    };
    Enums: {
      meal_slot: "breakfast" | "lunch" | "snacks" | "dinner";
      bill_status: "pending" | "processing" | "processed" | "failed";
      recurrence_frequency: "daily" | "weekly" | "monthly";
      task_occurrence_status: "pending" | "done" | "skipped";
    };
    Functions: {
      redeem_invite: {
        Args: { p_token: string };
        Returns: Database["public"]["Tables"]["household_memberships"]["Row"];
      };
      effective_recipes: {
        Args: { p_household: string };
        Returns: Database["public"]["Tables"]["recipes"]["Row"][];
      };
      mealplan_set_slot: {
        Args: { p_date: string; p_slot: "breakfast" | "lunch" | "snacks" | "dinner"; p_recipe_id: string | null };
        Returns: Database["public"]["Tables"]["meal_plans"]["Row"];
      };
      mealplan_regenerate_slot: {
        Args: { p_date: string; p_slot: "breakfast" | "lunch" | "snacks" | "dinner" };
        Returns: Database["public"]["Tables"]["meal_plans"]["Row"];
      };
      is_active_owner_or_maid: {
        Args: { p_household: string };
        Returns: boolean;
      };
      shopping_auto_add_from_plans: {
        Args: Record<string, never>;
        Returns: Database["public"]["Tables"]["shopping_list_items"]["Row"][];
      };
      ingest_bill_ocr: {
        Args: { p_bill_id: string; p_payload: Record<string, unknown> };
        Returns: Database["public"]["Tables"]["bills"]["Row"];
      };
      tasks_generate_occurrences: {
        Args: { p_horizon_date: string };
        Returns: number;
      };
      tasks_prune_old: {
        Args: { p_days?: number };
        Returns: number;
      };
    };
  };
};
