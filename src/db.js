const mongoose = require('mongoose');
const { mongoUri } = require('./config');

let memoryServer = null;

async function connectDb() {
  let uri = mongoUri;

  // Lokal sinov uchun: MONGODB_URI=memory — vaqtinchalik xotiradagi MongoDB
  if (!uri || uri === 'memory') {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('learn_clone');
    console.warn('[db] MONGODB_URI berilmagan — xotiradagi vaqtinchalik MongoDB ishlatilmoqda (ma\'lumot saqlanmaydi).');
  }

  await mongoose.connect(uri);
  console.log('[db] MongoDB ulandi');
}

async function closeDb() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

module.exports = { connectDb, closeDb };
