-- Rename demo auth emails from @ridley-demo.test to @equipmentiq-demo.test

update auth.users
set
  email = replace(email, '@ridley-demo.test', '@equipmentiq-demo.test'),
  raw_user_meta_data = case
    when raw_user_meta_data ? 'email' then
      jsonb_set(
        raw_user_meta_data,
        '{email}',
        to_jsonb(replace(coalesce(raw_user_meta_data->>'email', email), '@ridley-demo.test', '@equipmentiq-demo.test'))
      )
    else raw_user_meta_data
  end,
  updated_at = now()
where email like '%@ridley-demo.test';

update auth.identities
set
  identity_data = jsonb_set(
    identity_data,
    '{email}',
    to_jsonb(replace(identity_data->>'email', '@ridley-demo.test', '@equipmentiq-demo.test'))
  ),
  updated_at = now()
where identity_data->>'email' like '%@ridley-demo.test';

update public.profiles
set email = replace(email, '@ridley-demo.test', '@equipmentiq-demo.test')
where email like '%@ridley-demo.test';
