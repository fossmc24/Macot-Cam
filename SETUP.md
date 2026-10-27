# Setting up the admin page

## You do not need to do anything yet

The admin page works right now, with no setup at all:

<https://fossmc24.github.io/Macot-Cam/admin.html>

Open it, tap **Camera**, pick a part and start calibrating. Uploads, drafts and
publishing all work. There is no sign-in, because there is nothing to sign in
to — everything is saved **in the browser on that one device**, and the app on
that same device picks it up straight away.

That is all you need until you are ready for other people to see your parts.

### Two things to know about this mode

1. **Only that device sees it.** Calibrate on your phone and the app on your
   phone shows it. Your laptop, and everyone else, still sees the built-in
   parts. Publishing makes a part visible to the app, not to other people.
2. **Clearing your browser data would wipe it.** So in the admin page, go to
   **Library → Backup → ⭳ Save a backup file** now and then. That one file
   holds every calibration *and* every uploaded image or model. **⭱ Restore a
   backup** puts it back, on any device.

When you want to share for real, do the rest of this page. Nothing you
calibrate now is wasted — Step 7 sends it all up in one go, with no
re-calibrating.

---

## When you are ready to share: Supabase

This part takes about ten minutes, and is copy, paste and click.

## Why Supabase and not something else

The app is a set of plain files on GitHub Pages. GitHub Pages can only *serve*
files, it cannot *receive* them, so uploads have to go somewhere else.

I looked at the alternatives before building this:

- **Committing uploads back into the GitHub repo** would mean putting a token
  that can write to your repository inside a public web page. Anyone could take
  it and change your code. Not safe.
- **Cloudflare Workers / R2, Netlify, Vercel** would all work, but each one
  needs a separate account, a command-line deploy step, and a second thing to
  keep running.
- **Keeping everything in the phone's own storage** would mean the parts only
  existed on the one phone that made them, and nobody else would see them.

Supabase gives you file storage, a database, and a login in one place, all
reachable straight from a static page, and you already use it elsewhere. So
that is what this uses.

---

## Step 1 — Make the Supabase project

1. Go to <https://supabase.com> and sign in.
2. Click **New project**.
3. Give it a name — `mascot-cam` is fine.
4. Choose a region near you, set a database password (save it somewhere), and
   click **Create new project**.
5. Wait for it to finish setting up. It takes a minute or two.

## Step 2 — Run the setup script

1. In the left-hand menu, click **SQL Editor**.
2. Click **New query**.
3. Copy **everything** in the grey box below and paste it in.
4. Click **Run**.

You should see `Success. No rows returned`. If you see an error, see
*If something goes wrong* at the bottom.

```sql
-- ===== Mascot Cam: tables, security and the asset bucket =====

-- Who is allowed to change things. You add yourself in Step 4.
create table if not exists public.mascot_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- The calibration records. "record" holds the whole thing as JSON.
create table if not exists public.mascot_parts (
  id         text primary key,
  name       text not null,
  slot       text not null,
  type       text not null,
  asset_url  text,
  record     jsonb not null,
  published  boolean not null default false,
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Every save is kept, so a bad change can be undone.
create table if not exists public.mascot_part_versions (
  version_id bigint generated always as identity primary key,
  part_id    text not null,
  record     jsonb not null,
  version    integer not null,
  published  boolean not null default false,
  label      text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists mascot_part_versions_part_idx
  on public.mascot_part_versions (part_id, created_at desc);

-- A safe way for the rules below to ask "is this person an admin?"
create or replace function public.is_mascot_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mascot_admins where user_id = auth.uid())
$$;
revoke all on function public.is_mascot_admin() from public;
grant execute on function public.is_mascot_admin() to anon, authenticated;

-- Turn the locks on.
alter table public.mascot_parts          enable row level security;
alter table public.mascot_part_versions  enable row level security;
alter table public.mascot_admins         enable row level security;

drop policy if exists mascot_parts_read   on public.mascot_parts;
drop policy if exists mascot_parts_write  on public.mascot_parts;
drop policy if exists mascot_vers_read    on public.mascot_part_versions;
drop policy if exists mascot_vers_write   on public.mascot_part_versions;
drop policy if exists mascot_admins_read  on public.mascot_admins;

-- Anyone may read PUBLISHED parts. Drafts are admin-only.
create policy mascot_parts_read on public.mascot_parts
  for select to anon, authenticated
  using (published or public.is_mascot_admin());

-- Only you may add, change or remove parts.
create policy mascot_parts_write on public.mascot_parts
  for all to authenticated
  using (public.is_mascot_admin()) with check (public.is_mascot_admin());

create policy mascot_vers_read on public.mascot_part_versions
  for select to authenticated using (public.is_mascot_admin());
create policy mascot_vers_write on public.mascot_part_versions
  for all to authenticated
  using (public.is_mascot_admin()) with check (public.is_mascot_admin());

create policy mascot_admins_read on public.mascot_admins
  for select to authenticated using (public.is_mascot_admin());

-- ===== The bucket the uploaded art lives in =====
insert into storage.buckets (id, name, public)
values ('mascot-assets', 'mascot-assets', true)
on conflict (id) do update set public = true;

drop policy if exists mascot_assets_read   on storage.objects;
drop policy if exists mascot_assets_insert on storage.objects;
drop policy if exists mascot_assets_update on storage.objects;
drop policy if exists mascot_assets_delete on storage.objects;

-- Anyone may look at the art (the app has to be able to show it).
create policy mascot_assets_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'mascot-assets');

-- Only you may put files in, change them or remove them.
create policy mascot_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mascot-assets' and public.is_mascot_admin());
create policy mascot_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'mascot-assets' and public.is_mascot_admin());
create policy mascot_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mascot-assets' and public.is_mascot_admin());
```

## Step 3 — Make your login

1. In the left-hand menu, click **Authentication**, then **Users**.
2. Click **Add user** → **Create new user**.
3. Type your email address and a password you will remember.
4. Turn **Auto Confirm User** **on**. (Without this you would have to click a
   confirmation email first.)
5. Click **Create user**.

## Step 4 — Make yourself the admin

1. Go back to **SQL Editor** → **New query**.
2. Paste the line below, **changing the email to the one you just used**:

```sql
insert into public.mascot_admins (user_id)
select id from auth.users where email = 'you@example.com'
on conflict do nothing;
```

3. Click **Run**. It should say `Success`.

To check it worked, run this — it should return one row:

```sql
select u.email from public.mascot_admins a join auth.users u on u.id = a.user_id;
```

## Step 5 — Put your two values into the app

1. In the left-hand menu, click **Project Settings** (the cog), then **API**.
2. You need two things from that page:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon public** key — a long string starting `eyJ...`
3. Open the file `js/config.js` in this repository and paste them in:

```js
export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...the long anon key...';
```

4. Save and commit the change. GitHub Pages will update in a minute or so.

> **The anon key is meant to be public.** It only ever allows what the rules in
> Step 2 allow — reading published parts. The key you must *never* put in this
> repository is the one labelled **service_role**; it ignores every rule.

## Step 6 — Check it

1. Open <https://fossmc24.github.io/Macot-Cam/admin.html> on your phone.
2. Sign in with the email and password from Step 3.
3. You should see the part library, with every built-in part listed and
   **Published** next to it.
4. Go to **Library → Security check → Run the check**. The first line should be
   a tick, and so should the four below it. That confirms a stranger holding
   your public key can read published parts and do nothing else. If anything
   has a cross, run the script in Step 2 again.

## Step 7 — Move the parts you already made

Everything you calibrated before setting Supabase up is still on your device.

1. Open the admin page on **the device you calibrated on** (this matters — the
   parts are in that browser).
2. Go to **Library → Backup**.
3. Tap **⤴ Move this device's parts to Supabase**.

It uploads each piece of artwork and each calibration, keeping whether it was a
draft or published. Nothing is removed from your device, so if anything fails
you can simply try again. When it finishes it tells you how many moved.

Do this once per device you calibrated on.

That's it. From here on, publishing makes a part visible to everyone.

---

## If something goes wrong

**"Supabase is not configured yet"** — Step 5 has not been done, or the file
was not saved. Check `js/config.js` has both values in quotes.

**You can sign in, but saving says "not allowed" or "row level security"** —
Step 4 did not match your user. Run the check query in Step 4; if it returns no
rows, the email did not match exactly. Check for typos and capital letters.

**"Invalid login credentials"** — wrong password, or the user was created
without **Auto Confirm User** switched on. Delete the user in
**Authentication → Users** and make it again with that switch on.

**The app shows no uploaded parts** — a part only appears in the app once you
press **Publish**. Drafts are visible in the admin page only.

**A part you made on your phone is missing on your laptop** — expected before
Supabase is set up: parts live in the browser that made them. Either finish the
Supabase steps, or move it across with **Save a backup file** on one device and
**Restore a backup** on the other.

**You set up Supabase and your old parts vanished from the library** — they are
still on the device, the page is just reading the shared library now. Do Step 7
to send them up.

**You want to start over** — running the script in Step 2 again is safe; it
does not delete anything you have made.
