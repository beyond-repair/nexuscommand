-- A dependency must point at a mission that exists. Null means no dependency.

alter table missions drop constraint if exists missions_depends_on_fkey;

alter table missions
  add constraint missions_depends_on_fkey
  foreign key (depends_on) references missions (id);
