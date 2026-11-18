const { Telegraf, Markup, Input } = require('telegraf');
const Certificate = require('./models/Certificate');
const { createCertificate, normalizeFullName, courses, shareUrl } = require('./services/certificates');
const { createCertificatesWorkbook } = require('./services/certificate-export');
const { botToken, adminIds, publicUrl, useWebhook, webhookSecret } = require('./config');

const pending = new Map();
const activeExports = new Set();
const maxTelegramDocumentBytes = 50 * 1024 * 1024;

function logBotError(label, error) {
  const detail = error?.stack || error?.message || String(error);
  const sanitized = String(detail).replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/g, 'https://api.telegram.org/bot[REDACTED]');
  console.error(label, sanitized);
}

function isMessageUnchanged(error) {
  return error?.response?.error_code === 400 && /message is not modified/i.test(error.response.description || '');
}

async function answerCallback(ctx, text, extra) {
  try {
    await ctx.answerCbQuery(text, extra);
  } catch (e) {
    if (e?.response?.error_code === 400 && /query is too old|query ID is invalid/i.test(e.response.description || '')) {
      console.warn('[bot] callback expired before acknowledgement');
      return;
    }
    throw e;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function mainKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Yangi sertifikat', 'menu:new'),
      Markup.button.callback('📋 Ro‘yxat', 'menu:list'),
    ],
    [
      Markup.button.callback('🔎 Qidirish', 'menu:find'),
      Markup.button.callback('🗑 O‘chirish', 'menu:delete'),
    ],
    [Markup.button.callback('📤 Excel eksport', 'menu:export')],
  ]);
}

function cancelKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Bekor qilish', 'menu:home')]]);
}

function courseKeyboard() {
  return Markup.inlineKeyboard([
    ...courses.map((c) => [Markup.button.callback(c.title, `course:${c.slug}`)]),
    [Markup.button.callback('❌ Bekor qilish', 'menu:home')],
  ]);
}

function menuText() {
  return [
    '👋 <b>Coursera</b> — sertifikat boti',
    '',
    'Kerakli amalni tugmalardan tanlang. Yangi sertifikat uchun ism-familiyani yuboring.',
    '',
    'Buyruqlar: /new, /list, /find ism, /delete KOD, /export',
  ].join('\n');
}

function resultMessage(cert, password, link) {
  return [
    '✅ <b>Sertifikat yaratildi va bazaga saqlandi</b>',
    '',
    `👤 <b>F.I.Sh:</b> ${escapeHtml(cert.fullName)}`,
    `📚 <b>Kurs:</b> ${escapeHtml(cert.courseTitle)}`,
    `📅 <b>Sana:</b> ${new Date(cert.completedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    '',
    `📧 <b>Email (demo):</b> <code>${escapeHtml(cert.email)}</code>`,
    `🔑 <b>Parol:</b> <code>${escapeHtml(password)}</code>`,
    `🆔 <b>Kod:</b> <code>${cert.verifyCode}</code>`,
    '',
    `🔗 <b>Tasdiqlash linki:</b>\n${escapeHtml(link)}`,
    '',
    '<i>Parol bazada bcrypt hash ko‘rinishida saqlanadi va qayta tiklanmaydi.</i>',
  ].join('\n');
}

function resultKeyboard(link) {
  const rows = [];
  if (!/^https?:\/\/(localhost|127\.)/.test(link)) {
    rows.push([Markup.button.url('🌐 Sahifani ochish', link)]);
  }
  rows.push([Markup.button.callback('🏠 Bosh menyu', 'menu:home')]);
  return Markup.inlineKeyboard(rows);
}

function promptOptions() {
  return { parse_mode: 'HTML', ...cancelKeyboard() };
}

async function updatePrompt(ctx, state, text, extra = {}) {
  if (state?.messageId) {
    return ctx.telegram.editMessageText(ctx.chat.id, state.messageId, undefined, text, extra);
  }
  return ctx.replyWithHTML(text, extra);
}

async function deletePrivateMessage(ctx) {
  if (ctx.chat.type !== 'private') return;
  try {
    await ctx.deleteMessage();
  } catch (e) {
    logBotError('[bot] input message cleanup failed', e);
  }
}

async function showCertificateList(ctx, edit = false) {
  const items = await Certificate.find().sort({ createdAt: -1 }).limit(10).lean();
  const text = items.length
    ? items.map((c, i) => `${i + 1}. <b>${escapeHtml(c.fullName)}</b>\n   ${escapeHtml(c.courseTitle)}\n   ${escapeHtml(shareUrl(c))}`).join('\n\n')
    : 'Bazada hali sertifikat yo‘q.';
  const options = { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...mainKeyboard() };
  if (edit) return ctx.editMessageText(text, options);
  return ctx.reply(text, options);
}

async function updateExportStatus(telegram, chatId, messageId, text) {
  try {
    await telegram.editMessageText(chatId, messageId, undefined, text, mainKeyboard());
  } catch (e) {
    if (isMessageUnchanged(e)) return;
    logBotError('[bot] export status error', e);
  }
}

async function sendExport(telegram, chatId, statusMessageId) {
  try {
    const certificates = await Certificate.find().sort({ createdAt: -1, _id: -1 }).lean();
    if (!certificates.length) {
      await updateExportStatus(telegram, chatId, statusMessageId, 'Eksport qilish uchun sertifikat topilmadi.');
      return;
    }

    const workbook = await createCertificatesWorkbook(certificates);
    console.info(`[bot] export prepared: ${certificates.length} records, ${workbook.length} bytes`);
    if (workbook.length > maxTelegramDocumentBytes) {
      const error = new Error('Excel fayli Telegram’ning 50 MB limitidan katta.');
      error.code = 'EXPORT_TOO_LARGE';
      throw error;
    }

    const filename = `sertifikatlar-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const options = { caption: 'Parol ustunidagi qiymatlar ism asosida yaratilgan demo qiymatlar, haqiqiy login parollari emas.' };
    await telegram.sendDocument(chatId, Input.fromBuffer(workbook, filename), options);
  } catch (e) {
    logBotError('[bot] export error', e);
    const text = e.code === 'EXPORT_TOO_LARGE'
      ? '❌ Excel fayli Telegram yuborish limitidan katta chiqdi.'
      : '❌ Excel yuborilmadi. Bir ozdan so‘ng /export ni qayta yuboring.';
    await updateExportStatus(telegram, chatId, statusMessageId, text);
    return;
  }
  await updateExportStatus(telegram, chatId, statusMessageId, '✅ Excel fayli yuborildi.');
}

function startExport(telegram, chatId, statusMessageId) {
  if (activeExports.has(chatId)) {
    void updateExportStatus(telegram, chatId, statusMessageId, '⏳ Excel eksporti allaqachon tayyorlanmoqda.');
    return;
  }
  activeExports.add(chatId);
  void sendExport(telegram, chatId, statusMessageId)
    .catch((e) => logBotError('[bot] export task error', e))
    .finally(() => activeExports.delete(chatId));
}

async function promptForAction(ctx, type, text) {
  const messageId = ctx.callbackQuery.message.message_id;
  pending.set(ctx.chat.id, { type, messageId });
  return ctx.editMessageText(text, promptOptions());
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
    if (ctx.message) await ctx.reply(`⛔ Sizda ruxsat yo‘q. Telegram ID: ${id}`);
    return undefined;
  });

  bot.start(async (ctx) => {
    pending.delete(ctx.chat.id);
    const message = await ctx.replyWithHTML(menuText(), mainKeyboard());
    await deletePrivateMessage(ctx);
    return message;
  });

  bot.command('new', async (ctx) => {
    const message = await ctx.reply('✍️ O‘quvchining ism-familiyasini yuboring:', cancelKeyboard());
    pending.set(ctx.chat.id, { type: 'new', messageId: message.message_id });
    await deletePrivateMessage(ctx);
  });

  bot.command('list', async (ctx) => {
    const message = await showCertificateList(ctx);
    await deletePrivateMessage(ctx);
    return message;
  });

  bot.command('find', async (ctx) => {
    const q = ctx.message.text.replace(/^\/find(@\w+)?/i, '').trim();
    if (!q) {
      const message = await ctx.reply('Foydalanish: /find ism', mainKeyboard());
      await deletePrivateMessage(ctx);
      return message;
    }
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const items = await Certificate.find({ fullName: new RegExp(safe, 'i') }).sort({ createdAt: -1 }).limit(10).lean();
    if (!items.length) {
      const message = await ctx.reply('Topilmadi.', mainKeyboard());
      await deletePrivateMessage(ctx);
      return message;
    }
    const lines = items.map((c) => `<b>${escapeHtml(c.fullName)}</b> — ${escapeHtml(c.courseTitle)}\n<code>${escapeHtml(c.email)}</code>\n${escapeHtml(shareUrl(c))}`);
    const message = await ctx.replyWithHTML(lines.join('\n\n'), { link_preview_options: { is_disabled: true }, ...mainKeyboard() });
    await deletePrivateMessage(ctx);
    return message;
  });

  bot.command('delete', async (ctx) => {
    const code = ctx.message.text.replace(/^\/delete(@\w+)?/i, '').trim().toUpperCase();
    if (!code) {
      const message = await ctx.reply('Foydalanish: /delete KOD', mainKeyboard());
      await deletePrivateMessage(ctx);
      return message;
    }
    const res = await Certificate.deleteOne({ verifyCode: code });
    const message = await ctx.reply(res.deletedCount ? '🗑 O‘chirildi.' : 'Bunday kod topilmadi.', mainKeyboard());
    await deletePrivateMessage(ctx);
    return message;
  });

  bot.command('export', async (ctx) => {
    const message = await ctx.reply('⏳ Excel fayli tayyorlanmoqda…', mainKeyboard());
    await deletePrivateMessage(ctx);
    startExport(ctx.telegram, ctx.chat.id, message.message_id);
    return message;
  });

  bot.action(/^menu:(new|list|find|delete|export|home)$/, async (ctx) => {
    const action = ctx.match[1];
    await answerCallback(ctx);

    if (action === 'home') {
      pending.delete(ctx.chat.id);
      return ctx.editMessageText(menuText(), { parse_mode: 'HTML', ...mainKeyboard() });
    }
    if (action === 'new') {
      return promptForAction(ctx, 'new', '✍️ O‘quvchining ism-familiyasini yuboring:');
    }
    if (action === 'find') {
      return promptForAction(ctx, 'find', '🔎 Qidirish uchun ism yoki familiyani yuboring:');
    }
    if (action === 'delete') {
      return promptForAction(ctx, 'delete', '🗑 O‘chirish uchun sertifikat kodini yuboring:');
    }
    if (action === 'list') return showCertificateList(ctx, true);
    try {
      await ctx.editMessageText('⏳ Excel fayli tayyorlanmoqda…', mainKeyboard());
    } catch (e) {
      if (!isMessageUnchanged(e)) throw e;
    }
    startExport(ctx.telegram, ctx.chat.id, ctx.callbackQuery.message.message_id);
  });

  bot.action(/^course:(.+)$/, async (ctx) => {
    const state = pending.get(ctx.chat.id);
    if (state?.type !== 'course' || !state.name) {
      await answerCallback(ctx, 'Avval ism-familiyani yuboring.', { show_alert: true });
      return;
    }

    await answerCallback(ctx, 'Yaratilmoqda...');
    let result;
    try {
      result = await createCertificate({
        fullName: state.name,
        courseSlug: ctx.match[1],
        telegramId: ctx.from.id,
        username: ctx.from.username,
      });
    } catch (e) {
      logBotError('[bot] create error', e);
      return ctx.reply(`Xatolik: ${e.message}`, mainKeyboard());
    }

    pending.delete(ctx.chat.id);
    const text = resultMessage(result.cert, result.password, result.link);
    const options = {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...resultKeyboard(result.link),
    };
    try {
      return await ctx.editMessageText(text, options);
    } catch (e) {
      logBotError('[bot] result edit error', e);
      return ctx.replyWithHTML(text, options);
    }
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return undefined;
    const state = pending.get(ctx.chat.id);

    if (state?.type === 'find') {
      const safe = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const items = await Certificate.find({ fullName: new RegExp(safe, 'i') }).sort({ createdAt: -1 }).limit(10).lean();
      pending.delete(ctx.chat.id);
      const result = items.length
        ? items.map((c) => `<b>${escapeHtml(c.fullName)}</b> — ${escapeHtml(c.courseTitle)}\n<code>${escapeHtml(c.email)}</code>\n${escapeHtml(shareUrl(c))}`).join('\n\n')
        : 'Topilmadi.';
      const message = await ctx.telegram.editMessageText(ctx.chat.id, state.messageId, undefined, result, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...mainKeyboard(),
      });
      await deletePrivateMessage(ctx);
      return message;
    }

    if (state?.type === 'delete') {
      const code = text.toUpperCase();
      const result = await Certificate.deleteOne({ verifyCode: code });
      pending.delete(ctx.chat.id);
      const message = await ctx.telegram.editMessageText(
        ctx.chat.id,
        state.messageId,
        undefined,
        result.deletedCount ? '🗑 Sertifikat o‘chirildi.' : 'Bunday kod topilmadi.',
        mainKeyboard()
      );
      await deletePrivateMessage(ctx);
      return message;
    }

    const name = normalizeFullName(text);
    if (name.length < 3 || !/\p{L}/u.test(name)) {
      if (state?.messageId) {
        const message = await updatePrompt(ctx, state, 'Iltimos, to‘g‘ri ism-familiya yuboring:', promptOptions());
        await deletePrivateMessage(ctx);
        return message;
      }
      const message = await ctx.reply('Iltimos, to‘g‘ri ism-familiya yuboring.', mainKeyboard());
      await deletePrivateMessage(ctx);
      return message;
    }

    const prompt = `👤 <b>${escapeHtml(name)}</b>\n\n📚 Kursni tanlang:`;
    const nextState = { type: 'course', name, messageId: state?.messageId };
    pending.set(ctx.chat.id, nextState);
    if (nextState.messageId) {
      const message = await ctx.telegram.editMessageText(ctx.chat.id, nextState.messageId, undefined, prompt, {
        parse_mode: 'HTML',
        ...courseKeyboard(),
      });
      await deletePrivateMessage(ctx);
      return message;
    }
    const message = await ctx.replyWithHTML(prompt, courseKeyboard());
    nextState.messageId = message.message_id;
    await deletePrivateMessage(ctx);
    return message;
  });

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
