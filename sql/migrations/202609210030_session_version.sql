-- Версия сессии: позволяет разом отозвать все входы пользователя
-- (смена пароля, сброс по ссылке, смена пароля админом, удаление, исключение из базы).
alter table app_users add column if not exists session_version int not null default 1;
