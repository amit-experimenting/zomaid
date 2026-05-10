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
      // households, household_memberships, invites — added in later tasks.
    };
    Views: {
      // No views yet.
    };
    Functions: {
      // redeem_invite — added in Task 8.
    };
  };
};
