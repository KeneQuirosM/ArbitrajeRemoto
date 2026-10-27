-- Shirt numbers up to 999 (futsal and amateur leagues use numbers such as 108).
-- Replaces the 1–99 checks of 20261023120000_init.sql. Safe to run again.
alter table arbitraje.events drop constraint if exists events_player_number_check;
alter table arbitraje.events drop constraint if exists events_player_out_number_check;
alter table arbitraje.events drop constraint if exists events_player_in_number_check;
alter table arbitraje.events add constraint events_player_number_check check (player_number between 1 and 999);
alter table arbitraje.events add constraint events_player_out_number_check check (player_out_number between 1 and 999);
alter table arbitraje.events add constraint events_player_in_number_check check (player_in_number between 1 and 999);
