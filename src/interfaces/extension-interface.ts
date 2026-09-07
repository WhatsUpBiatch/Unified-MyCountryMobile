export interface IUSERS {
  first_name: string;
  last_name: string;
  phone: string;
  role: string;
  extension: string;
  email: string;
  profile: string;
  site: {
    name: string;
  };
  uuid: string;
  user_uuid?: string;
  caller_id: string;
  role_data: {
    name: string
  }
  custom_role_data: {
    name: string
  }
}

export interface IADDUSER {
  user_add_count: number | null;
  site: { label: string; value: string };
  users: {
    email: string;
    first_name: string;
    last_name: string;
    extension: string;
    phone: string;
    password: string;
    confirm_password: string;
    role: { label: string; value: string };
  }[];
  password: string;
  confirm_password: string;
  password_type: 'common' | 'individual' | 'email';
}
