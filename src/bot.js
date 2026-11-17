const { Telegraf, Markup } = require('telegraf');
const Certificate = require('./models/Certificate');
const { createCertificate, normalizeFullName, courses, shareUrl } = require('./services/certificates');
const { botToken, adminIds, publicUrl, useWebhook, webhookSecret } = require('./config');

// Har bir chat uchun vaqtinchalik holat: kiritilgan ism-familiya
const pending = new Map();

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function courseKeyboard() {
  return Markup.inlineKeyboard([
    ...courses.map((c) => [Markup.button.callback(c.title, `course:${c.slug}`)]),
    [Markup.button.callback('❌ Bekor qilish', 'cancel')],
  ]);
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
    `🔗 <b>Tasdiqlash linki:</b>\n${link}`,
    '',
    '<i>Parol faqat hozir ko\'rsatiladi — bazada shifrlangan holda saqlanadi.</i>',
  ].join('\n');
}

function createBot() {
  if (!botToken) {
    console.warn('[bot] BOT_TOKEN berilmagan — Telegram bot ishga tushmaydi.');
    return null;
  }

  const bot = new Telegraf(botToken);

  // Faqat adminlar (ADMIN_IDS bo'sh bo'lsa — hamma)
  bot.use(async (ctx, next) => {
    if (!adminIds.length) return next();
    const id = String(ctx.from?.id || '');
    if (adminIds.includes(id)) return next();
    if (ctx.message) await ctx.reply(`⛔ Sizda ruxsat yo'q. Telegram ID: ${id}`);
    return undefined;
  });

  bot.start((ctx) =>
    ctx.replyWithHTML(
      [
        '👋 <b>Learn (clone)</b> — sertifikat boti',
        '',
        'O\'quvchining <b>ism-familiyasini</b> yuboring, masalan:',
        '<code>ILHOMJONOVA MUBINAXON HUSNIDDIN QIZI</code>',
        '',
        'Keyin kursni tanlaysiz — bot email, parol va tasdiqlash linkini beradi.',
        '',
        'Buyruqlar:',
        '/new — yangi sertifikat',
        '/list — oxirgi 10 ta sertifikat',
        '/find <i>ism</i> — qidirish',
        '/delete <i>kod</i> — o\'chirish',
      ].join('\n')
    )
  );

  bot.command('new', (ctx) => {
    pending.delete(ctx.chat.id);
    return ctx.reply('✍️ O\'quvchining ism-familiyasini yuboring:');
  });

  bot.command('list', async (ctx) => {
    const items = await Certificate.find().sort({ createdAt: -1 }).limit(10).lean();
    if (!items.length) return ctx.reply('Bazada hali sertifikat yo\'q.');
    const lines = items.map(
      (c, i) => `${i + 1}. <b>${escapeHtml(c.fullName)}</b>\n   ${escapeHtml(c.courseTitle)}\n   ${shareUrl(c)}`
    );
    return ctx.replyWithHTML(lines.join('\n\n'), { link_preview_options: { is_disabled: true } });
  });

  bot.command('find', async (ctx) => {
    const q = ctx.message.text.replace(/^\/find(@\w+)?/i, '').trim();
    if (!q) return ctx.reply('Foydalanish: /find ism');
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const items = await Certificate.find({ fullName: new RegExp(safe, 'i') }).sort({ createdAt: -1 }).limit(10).lean();
    if (!items.length) return ctx.reply('Topilmadi.');
    const lines = items.map((c) => `<b>${escapeHtml(c.fullName)}</b> — ${escapeHtml(c.courseTitle)}\n<code>${c.email}</code>\n${shareUrl(c)}`);
    return ctx.replyWithHTML(lines.join('\n\n'), { link_preview_options: { is_disabled: true } });
  });

  bot.command('delete', async (ctx) => {
    const code = ctx.message.text.replace(/^\/delete(@\w+)?/i, '').trim().toUpperCase();
    if (!code) return ctx.reply('Foydalanish: /delete KOD');
    const res = await Certificate.deleteOne({ verifyCode: code });
    return ctx.reply(res.deletedCount ? '🗑 O\'chirildi.' : 'Bunday kod topilmadi.');
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return undefined;
    const name = normalizeFullName(text);
    if (name.length < 3 || !/\p{L}/u.test(name)) {
      return ctx.reply('Iltimos, to\'g\'ri ism-familiya yuboring.');
    }
    pending.set(ctx.chat.id, name);
    return ctx.replyWithHTML(`👤 <b>${escapeHtml(name)}</b>\n\n📚 Kursni tanlang:`, courseKeyboard());
  });

  bot.action('cancel', async (ctx) => {
    pending.delete(ctx.chat.id);
    await ctx.answerCbQuery('Bekor qilindi');
    return ctx.editMessageText('Bekor qilindi. Yangi ism-familiya yuborishingiz mumkin.');
  });

  bot.action(/^course:(.+)$/, async (ctx) => {
    const name = pending.get(ctx.chat.id);
    if (!name) {
      await ctx.answerCbQuery();
      return ctx.reply('Avval ism-familiyani yuboring.');
    }
    await ctx.answerCbQuery('Yaratilmoqda...');
    try {
      const { cert, password, link } = await createCertificate({
        fullName: name,
        courseSlug: ctx.match[1],
        telegramId: ctx.from.id,
        username: ctx.from.username,
      });
      pending.delete(ctx.chat.id);
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      // Telegram localhost URL tugmasini qabul qilmaydi — faqat ochiq URL bo'lsa tugma qo'shamiz
      const isLocal = /^https?:\/\/(localhost|127\.)/.test(link);
      const keyboard = isLocal ? {} : Markup.inlineKeyboard([[Markup.button.url('🌐 Sahifani ochish', link)]]);
      return ctx.replyWithHTML(resultMessage(cert, password, link), {
        ...keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch (e) {
      console.error('[bot] create error', e);
      return ctx.reply(`Xatolik: ${e.message}`);
    }
  });

  bot.catch((err) => console.error('[bot] error', err));

  return bot;
}

/** Botni Express ilovasiga ulaydi: Render'da webhook, lokalda polling. */
async function startBot(app) {
  const bot = createBot();
  if (!bot) return null;

  if (useWebhook) {
    // Yo'l token'dan hosil qilinadi (tashqaridan taxmin qilib bo'lmaydi); secret_token ni Telegraf o'zi tekshiradi
    const hookPath = `/telegram/webhook/${bot.secretPathComponent()}`;
    app.use(await bot.createWebhook({ domain: publicUrl, path: hookPath, secret_token: webhookSecret || undefined }));
    console.log(`[bot] webhook rejimi: ${publicUrl}/telegram/webhook/***`);
  } else {
    await bot.telegram.deleteWebhook().catch(() => {});
    bot.launch().catch((e) => console.error('[bot] launch error', e));
    console.log('[bot] polling rejimi ishga tushdi');
  }

  return bot;
}

module.exports = { startBot, createBot };
