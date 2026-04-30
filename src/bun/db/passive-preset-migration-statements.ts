export const PARK_PASSIVE_SESSION_ID_STATEMENTS = [
  `delete from session_remote_prompts
   where session_id in (
     select s.session_id
     from sessions s
     left join settings st on st.id = 1
     where s.preset = 'passive'
       or (s.preset is null and st.global_preset = 'passive')
   )`,
  `update sessions set preset = null, active_since = null where preset = 'passive'`,
  `update sessions
   set active_since = null
   where preset is null
     and (select global_preset from settings where id = 1) = 'passive'`,
  `update settings set global_preset = null where global_preset = 'passive'`,
];

export const PARK_PASSIVE_OVERRIDABLE_SESSION_ID_STATEMENTS = [
  `delete from session_remote_prompts
   where session_id in (
     select s.session_id
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
];
