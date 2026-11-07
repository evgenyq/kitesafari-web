-- Rollback for 011_bot.sql
BEGIN;

DROP FUNCTION IF EXISTS bot_apply_proposal(uuid, text);
DROP FUNCTION IF EXISTS bot_release_lock(bigint);
DROP FUNCTION IF EXISTS bot_try_lock(bigint);
DROP TABLE IF EXISTS bot_chat_locks;
DROP TABLE IF EXISTS bot_proposals;
DROP TABLE IF EXISTS bot_messages;

COMMIT;
