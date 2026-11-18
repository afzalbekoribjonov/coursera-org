async function callTelegramApiWithTimeout(telegram, method, payload, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await telegram.callApi(method, payload, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { callTelegramApiWithTimeout };
