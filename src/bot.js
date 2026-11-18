const { Telegraf } = require('telegraf');
const Certificate = require('./models/Certificate');
const { createCertificatesWorkbook } = require('./services/certificate-export');
const { parseImportWorkbook, importCertificates, createTemplateWorkbook, MAX_ROWS } = require('./services/certificate-import');
const { botToken, adminIds, publicUrl, useWebhook, webhookSecret } = require('./config');

const activeImports = new Set();
const maxImportBytes = 5 * 1024 * 1024;

/** Hujjatni Node'ning o'z fetch'i bilan yuboradi (Telegraf'ning node-fetch keep-alive ulanishi "socket hang up" beradi). */
async function uploadDocument(chatId, buffer, filename, caption) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', caption);
      form.append('document', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) return data.result;
      const error = new Error(`Telegram sendDocument: ${res.status} ${data.description || ''}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(error, { fatal: true });
      lastError = error;
    } catch (e) {
      if (e.fatal) throw e;
      lastError = e;
    }
    console.warn(`[bot] sendDocument attempt ${attempt} failed: ${lastError?.cause?.code || lastError?.message}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  throw lastError;
}

function logBotError(label, error) {
  const detail = error?.stack || error?.message || String(error);
  const sanitized = String(detail).replace(/https:\/\/api\.telegram\.org\/(file\/)?bot[^/\s]+/g, 'https://api.telegram.org/$1bot[REDACTED]');
  console.error(label, sanitized);
}

const instructions = [
  'Sertifikat yaratish uchun Excel (.xlsx) fayl yuboring.',
  '',
  'Fayl shabloni:',
  '1-qator: sarlavhalar - "Ism familiya" va "Gmail"',
  '2-qatordan boshlab: A ustunda ism familiya, B ustunda gmail manzil',
  '',
  `Bir yuborishda ${MAX_ROWS} tagacha qator qabul qilinadi.`,
  'Kurs, sana, parol, kod va link avtomatik to‘ldiriladi va bazaga saqlanadi.',
  'Natija Excel fayl ko‘rinishida qaytariladi: ism familiya, email, parol, sertifikat linki.',
].join('\n');

async function sendInstructions(ctx) {
  await ctx.reply(instructions);
  await uploadDocument(ctx.chat.id, await createTemplateWorkbook(), 'shablon.xlsx', 'Shablon fayl');
}

async function downloadFile(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Fayl yuklab olinmadi: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function summaryText({ created, errors, ignored }) {
  const lines = [`Bazaga saqlandi: ${created.length} ta sertifikat.`];
  if (ignored) lines.push(`Limitdan oshgani uchun ${ignored} ta qator qabul qilinmadi (maksimum ${MAX_ROWS}).`);
  if (errors.length) {
    lines.push('', `O'tkazib yuborilgan qatorlar: ${errors.length} ta`);
    lines.push(...errors.slice(0, 20));
    if (errors.length > 20) lines.push(`... va yana ${errors.length - 20} ta`);
  }
  return lines.join('\n');
}

async function handleImport(ctx) {
  const doc = ctx.message.document;
  if (!/\.xlsx$/i.test(doc.file_name || '')) {
    return ctx.reply(`Faqat .xlsx formatdagi Excel fayl qabul qilinadi.\n\n${instructions}`);
  }
  if (doc.file_size > maxImportBytes) return ctx.reply('Fayl hajmi 5 MB dan oshmasligi kerak.');
  if (activeImports.has(ctx.chat.id)) return ctx.reply('Oldingi fayl hali qayta ishlanmoqda. Iltimos, kuting.');

  activeImports.add(ctx.chat.id);
  try {
    const parsed = await parseImportWorkbook(await downloadFile(ctx, doc.file_id));
    if (!parsed.rows.length) {
      const reason = parsed.errors.length ? `\n\n${parsed.errors.slice(0, 20).join('\n')}` : '';
      return await ctx.reply(`Faylda yaroqli qator topilmadi.${reason}\n\n${instructions}`);
    }

    const { created, errors } = await importCertificates(parsed.rows, { telegramId: ctx.from.id, username: ctx.from.username });
    const report = { created, errors: [...parsed.errors, ...errors], ignored: parsed.ignored };
    await ctx.reply(summaryText(report));
    if (!created.length) return undefined;

    // Saqlangan ma'lumotlar qayta yig'ilib, foydalanuvchiga Excel ko'rinishida qaytariladi.
    const stored = await Certificate.find({ email: { $in: created.map((c) => c.email) } }).lean();
    const byEmail = new Map(stored.map((c) => [c.email, c]));
    const rows = created.map((c) => ({ ...byEmail.get(c.email), fullName: c.fullName, email: c.email, password: c.password }));
    const workbook = await createCertificatesWorkbook(rows);
    return await uploadDocument(ctx.chat.id, workbook, `sertifikatlar-${new Date().toISOString().slice(0, 10)}.xlsx`, `Sertifikatlar: ${created.length} ta`);
  } catch (e) {
    logBotError('[bot] import error', e);
    return ctx.reply('Faylni qayta ishlashda xatolik yuz berdi. Fayl shablonga mosligini tekshirib, qayta yuboring.');
  } finally {
    activeImports.delete(ctx.chat.id);
  }
}

function createBot() {
  if (!botToken) {
    console.warn('[bot] BOT_TOKEN berilmagan — Telegram bot ishga tushmaydi.');
    return null;
  }

  const bot = new Telegraf(botToken);
  // Webhook rejimida birinchi API chaqiruvi HTTP javob sifatida ketib, `true` qaytaradi (message_id yo'qoladi).
  bot.telegram.webhookReply = false;

  bot.use(async (ctx, next) => {
    if (!adminIds.length) return next();
    const id = String(ctx.from?.id || '');
    if (adminIds.includes(id)) return next();
    if (ctx.message) await ctx.reply(`Sizda ruxsat yo‘q. Telegram ID: ${id}`);
    return undefined;
  });

  bot.start(sendInstructions);
  bot.on('document', handleImport);
  bot.on('message', sendInstructions);

  bot.catch((err) => logBotError('[bot] error', err));

  return bot;
}

/** Botni Express ilovasiga ulaydi: Render'da webhook, lokalda polling. */
async function startBot(app) {
  const bot = createBot();
  if (!bot) return null;

  if (useWebhook) {
    const hookPath = `/telegram/webhook/${bot.secretPathComponent()}`;
    app.use(await bot.createWebhook({ domain: publicUrl, path: hookPath, secret_token: webhookSecret || undefined }));
    console.log(`[bot] webhook rejimi: ${publicUrl}/telegram/webhook/***`);
  } else {
    await bot.telegram.deleteWebhook().catch(() => {});
    bot.launch().catch((e) => logBotError('[bot] launch error', e));
    console.log('[bot] polling rejimi ishga tushdi');
  }

  return bot;
}

module.exports = { startBot, createBot };
