-- Must run (and commit) before policies that cast 'vendor'::user_role.
alter type public.user_role add value if not exists 'vendor';
