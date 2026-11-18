const assert = require('node:assert/strict');
const test = require('node:test');
const { createApp } = require('./server');

test('JSON webhook body remains readable by middleware added after app routes', async () => {
  const app = createApp();
  app.post('/telegram/webhook/test', async (req, res) => {
    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    res.json(JSON.parse(rawBody));
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 1, message: { text: '/start' } }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { update_id: 1, message: { text: '/start' } });
  } finally {
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
  }
});
