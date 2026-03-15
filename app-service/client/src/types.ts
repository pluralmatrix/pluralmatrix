export interface SystemMember {
  id: string;
  slug: string;
  name: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  pronouns?: string | null;
  description?: string | null;
  color?: string | null;
  proxyTags?: { prefix?: string; suffix?: string }[];
  groups?: { id: string; name: string; color?: string }[];
  privacy?: Record<string, string>;
  [key: string]: unknown;
}

export interface SystemGroup {
  id: string;
  slug: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  privacy?: Record<string, string>;
  [key: string]: unknown;
}

export interface PluralSystem {
  id: string;
  slug: string;
  name?: string | null;
  systemTag?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  color?: string | null;
  autoproxyMode?: string;
  proxyAutoswitch?: string;
  autoproxyId?: string | null;
  privacy?: Record<string, string>;
  [key: string]: unknown;
}
