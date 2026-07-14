UPDATE wa_conversations AS legacy
LEFT JOIN wa_conversations AS canonical
  ON canonical.account_id = legacy.account_id
  AND canonical.chat_id = CONCAT(SUBSTRING_INDEX(legacy.chat_id, '@', 1), '@s.whatsapp.net')
SET legacy.chat_id = CONCAT(SUBSTRING_INDEX(legacy.chat_id, '@', 1), '@s.whatsapp.net')
WHERE legacy.chat_id LIKE '%@c.us'
  AND canonical.id IS NULL;

UPDATE wa_messages AS message
JOIN wa_conversations AS legacy
  ON legacy.id = message.conversation_id
JOIN wa_conversations AS canonical
  ON canonical.account_id = legacy.account_id
  AND canonical.chat_id = CONCAT(SUBSTRING_INDEX(legacy.chat_id, '@', 1), '@s.whatsapp.net')
SET message.conversation_id = canonical.id
WHERE legacy.chat_id LIKE '%@c.us';

DELETE legacy
FROM wa_conversations AS legacy
JOIN wa_conversations AS canonical
  ON canonical.account_id = legacy.account_id
  AND canonical.chat_id = CONCAT(SUBSTRING_INDEX(legacy.chat_id, '@', 1), '@s.whatsapp.net')
WHERE legacy.chat_id LIKE '%@c.us';

UPDATE wa_messages
SET chat_id = CONCAT(SUBSTRING_INDEX(chat_id, '@', 1), '@s.whatsapp.net')
WHERE chat_id LIKE '%@c.us';

UPDATE wa_messages
SET sender_id = CONCAT(SUBSTRING_INDEX(sender_id, '@', 1), '@s.whatsapp.net')
WHERE sender_id LIKE '%@c.us';

UPDATE wa_messages
SET recipient_id = CONCAT(SUBSTRING_INDEX(recipient_id, '@', 1), '@s.whatsapp.net')
WHERE recipient_id LIKE '%@c.us';

UPDATE wa_send_job_items
SET chat_id = CONCAT(SUBSTRING_INDEX(chat_id, '@', 1), '@s.whatsapp.net')
WHERE chat_id LIKE '%@c.us';
