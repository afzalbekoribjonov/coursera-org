// Bitta Node.js jarayoni: Express (backend + frontend) + Telegram bot + MongoDB
const { connectDb, closeDb } = require('./db');
const { createApp, attachFallbacks } = require('./server');
const { startBot } = require('./bot');
const { port, publicUrl } = require('./config');

async function main() {
  await connectDb();

  const app = createApp();
  let bot = null;
  try {
    bot = await startBot(app); // webhook route 404 handlerdan oldin ulanishi kerak
  } catch (e) {
    console.error('[bot] ishga tushmadi:', e.message);
  }
  attachFallbacks(app);

  const server = app.listen(port, () => {
    console.log(`[web] ${publicUrl} (port ${port})`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} — to'xtatilmoqda...`);
    if (bot) {
      try { bot.stop(signal); } catch (_) { /* webhook rejimida stop kerak emas */ }
    }
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
