-- Campaigns made or edited in the app are left alone by the config seed on boot.
alter table campaigns add column if not exists managed_by text not null default 'config' check (managed_by in ('config','app'));
