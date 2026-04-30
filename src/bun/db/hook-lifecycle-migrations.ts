import type { AppMigration } from "./migrations";

export const hookLifecycleMigrations: AppMigration[] = [
  {
    id: 20,
    name: "hook_lifecycle_status",
    statements: [
      `alter table settings add column hook_removal_pending integer not null default 0 check (hook_removal_pending in (0, 1))`,
      `alter table settings add column hook_removal_next_attempt_at text`,
      `alter table settings add column hook_lifecycle_status_json text`,
      `update settings set hook_removal_pending = 0 where hook_removal_pending is null`,
    ],
  },
  {
    id: 21,
    name: "park_passive_v1",
    statements: [
      `delete from session_remote_prompts
       where thread_id in (
         select s.thread_id
         from sessions s
         left join settings st on st.id = 1
         where s.preset = 'passive'
           or (
             s.preset is null
             and s.preset_overridden = 0
             and st.global_preset = 'passive'
           )
       )`,
      `update sessions set preset = null, preset_overridden = 1, active_since = null where preset = 'passive'`,
      `update sessions
       set active_since = null
       where preset is null
         and preset_overridden = 0
         and (select global_preset from settings where id = 1) = 'passive'`,
      `update settings set global_preset = null where global_preset = 'passive'`,
    ],
  },
  {
    id: 22,
    name: "telegram_mirror_mode",
    statements: [
      `alter table settings add column mirror_enabled integer not null default 0 check (mirror_enabled in (0, 1))`,
      `update settings set mirror_enabled = 0 where mirror_enabled is null`,
    ],
  },
];
