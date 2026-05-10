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
    };
    Views: {
      // No views yet.
    };
    Functions: {
      redeem_invite: {
        Args: { p_token: string };
        Returns: Database["public"]["Tables"]["household_memberships"]["Row"];
      };
    };
  };
};
