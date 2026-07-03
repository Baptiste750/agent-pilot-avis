create table if not exists clients (
  id text primary key,
  business_name text not null,
  contact_name text default '',
  email text not null unique,
  password_hash text not null,
  status text not null default 'active',
  google_location_id text default '',
  sync_from_date date not null default current_date,
  reply_policy text not null,
  email_template text not null,
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id text primary key,
  google_review_id text unique,
  client_id text not null references clients(id) on delete cascade,
  author text not null default 'Client Google',
  rating integer not null check (rating between 1 and 5),
  text text not null,
  suggested_reply text not null,
  status text not null default 'pending',
  published_reply text default '',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists reviews_client_id_idx on reviews(client_id);
create index if not exists reviews_status_idx on reviews(status);

create table if not exists sessions (
  token text primary key,
  role text not null,
  user_id text not null,
  expires_at timestamptz not null
);

create index if not exists sessions_expires_at_idx on sessions(expires_at);

create table if not exists email_logs (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_logs_client_id_idx on email_logs(client_id);

create table if not exists google_tokens (
  id text primary key,
  client_id text references clients(id) on delete cascade,
  access_token text not null default '',
  refresh_token text not null default '',
  expires_at timestamptz,
  scope text default '',
  connected_email text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists google_tokens_client_id_idx on google_tokens(client_id);

alter table clients enable row level security;
alter table reviews enable row level security;
alter table sessions enable row level security;
alter table email_logs enable row level security;
alter table google_tokens enable row level security;
