const assert = require('node:assert/strict');
const test = require('node:test');
const { callTelegramApiWithTimeout } = require('./telegram-upload');

test('Telegram upload requests are aborted after the configured timeout', async () => {
  const telegram = {
    callApi: (_method, _payload, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('Request aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  };

  await assert.rejects(
    callTelegramApiWithTimeout(telegram, 'sendDocument', {}, 10),
    { name: 'AbortError' }
  );
});
