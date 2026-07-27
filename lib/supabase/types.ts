export type Database = {
  public: {
    Tables: {
      students: {
        Row: {
          id: string;
          name: string;
          age: number | null;
          parent_phone: string;
          parent_phone_last4: string;
          memo: string | null;
          class_days: string[];
          payment_day: number | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          age?: number | null;
          parent_phone: string;
          memo?: string | null;
          class_days?: string[];
          payment_day?: number | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          age?: number | null;
          parent_phone?: string;
          memo?: string | null;
          class_days?: string[];
          payment_day?: number | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          student_id: string;
          check_in_at: string;
          check_out_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          check_in_at?: string;
          check_out_at?: string | null;
          created_at?: string;
        };
        Update: {
          check_out_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_records_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_overrides: {
        Row: {
          id: string;
          student_id: string;
          date: string;
          status: string;
          makeup_date: string | null;
          class_days_snapshot: string[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          date: string;
          status: string;
          makeup_date?: string | null;
          class_days_snapshot?: string[] | null;
          created_at?: string;
        };
        Update: {
          status?: string;
          makeup_date?: string | null;
          class_days_snapshot?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_overrides_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
