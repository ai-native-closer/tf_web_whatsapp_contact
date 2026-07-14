"use strict";

const DIRECT_CHAT_SUFFIXES = ["@s.whatsapp.net", "@c.us", "@lid"];

function normalizePhone(input) {
  const digits = String(input || "").replace(/\D/g, "");

  if (digits.length < 6 || digits.length > 15) {
    throw new Error(`Invalid international phone number: ${input}`);
  }

  return digits;
}

function toChatId(input) {
  return `${normalizePhone(input)}@s.whatsapp.net`;
}

function isDirectChatId(chatId) {
  const value = String(chatId || "");
  return DIRECT_CHAT_SUFFIXES.some((suffix) => value.endsWith(suffix));
}

function phoneFromChatId(chatId) {
  const value = String(chatId || "");
  if (!value.endsWith("@s.whatsapp.net") && !value.endsWith("@c.us")) {
    return null;
  }

  const phone = value.split("@")[0].split(":")[0];
  return /^\d{6,15}$/.test(phone) ? phone : null;
}

function parseRecipients(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || "").split(/[\s,;，；]+/);

  const seen = new Set();
  const recipients = [];

  for (const value of raw) {
    if (!String(value || "").trim()) {
      continue;
    }

    const phone = normalizePhone(value);
    if (!seen.has(phone)) {
      seen.add(phone);
      recipients.push(phone);
    }
  }

  return recipients;
}

module.exports = {
  normalizePhone,
  parseRecipients,
  toChatId,
  isDirectChatId,
  phoneFromChatId
};
