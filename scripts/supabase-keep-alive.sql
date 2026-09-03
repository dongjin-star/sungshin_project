-- .github/workflows/keep-alive.yml 이 조회할 테이블.
--
-- Supabase 대시보드 > SQL Editor 에 그대로 붙여넣고 한 번만 실행하면 된다.
-- (앱 데이터와 무관한, 핑 전용 1행짜리 테이블이다.)

create table if not exists public.keep_alive (
  id smallint primary key default 1,
  pinged_at timestamptz not null default now(),
  constraint keep_alive_single_row check (id = 1)
);

insert into public.keep_alive (id) values (1)
on conflict (id) do nothing;

alter table public.keep_alive enable row level security;

-- 읽기만 공개한다. 민감 정보가 없고, 쓰기 정책은 만들지 않으므로
-- publishable 키로는 SELECT 외에 아무것도 할 수 없다.
drop policy if exists "keep_alive_public_read" on public.keep_alive;
create policy "keep_alive_public_read"
  on public.keep_alive
  for select
  to anon, authenticated
  using (true);
