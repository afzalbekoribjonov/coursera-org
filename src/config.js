require('dotenv').config({ quiet: true });

const port = Number(process.env.PORT) || 3000;

// Render avtomatik RENDER_EXTERNAL_URL beradi (masalan https://learn-clone.onrender.com)
const publicUrl = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${port}`
).replace(/\/+$/, '');

module.exports = {
  port,
  publicUrl,
  mongoUri: process.env.MONGODB_URI || '',
  botToken: process.env.BOT_TOKEN || '',
  // Vergul bilan ajratilgan Telegram user ID lar. Bo'sh bo'lsa — hamma foydalana oladi.
  adminIds: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Webhook faqat ochiq https URL bo'lsa ishlatiladi, aks holda polling.
  useWebhook: /^https:\/\//.test(publicUrl) && process.env.BOT_MODE !== 'polling',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  brand: 'Learn',
};
