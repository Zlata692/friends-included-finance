create table employees (
  id text primary key,
  name text not null,
  role text not null check (role in ('manager','sales','expense')),
  telegram_user_id text unique,
  telegram_chat_id text
);

create table transactions (
  reference text primary key,
  type text not null check (type in ('sale','expense')),
  submitted_by text not null references employees(id),
  submitted_at timestamptz not null default now(),
  notification_chat_id text,
  payload jsonb not null,
  proposal jsonb not null,
  decision jsonb,
  status text not null,
  sync_status text not null default 'pending',
  notification_status text not null default 'not_required'
);

-- The app accesses these tables only through the server-side service role.
-- Public browser clients remain denied even though the tables are visible in Data API.
alter table employees enable row level security;
alter table transactions enable row level security;
revoke all on table employees, transactions from anon, authenticated;
