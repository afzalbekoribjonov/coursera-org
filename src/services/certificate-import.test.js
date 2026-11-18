const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Certificate = require('../models/Certificate');
const { parseImportWorkbook, importCertificates, createTemplateWorkbook, MAX_ROWS } = require('./certificate-import');

async function workbookBuffer(rows, header = ['Ism familiya', 'Gmail']) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(header);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('template can be parsed back by the importer', async () => {
  const parsed = await parseImportWorkbook(await createTemplateWorkbook());
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.errors.length, 0);
});

test('parser validates rows, rejects duplicates and enforces the limit', async () => {
  const rows = [['ali valiyev', 'Ali@Gmail.com'], ['x', 'bad'], ['Vali Aliyev', 'ali@gmail.com'], ['Sami Karimov', 'nope']];
  const parsed = await parseImportWorkbook(await workbookBuffer(rows));
  assert.deepEqual(parsed.rows.map((r) => [r.fullName, r.email]), [['ALI VALIYEV', 'ali@gmail.com']]);
  assert.equal(parsed.errors.length, 3);

  const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => [`Student Number${i}`, `s${i}@gmail.com`]);
  const limited = await parseImportWorkbook(await workbookBuffer(many));
  assert.equal(limited.rows.length, MAX_ROWS);
  assert.equal(limited.ignored, 5);
});

test('import stores certificates with generated fields and skips existing emails', async () => {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  try {
    const rows = [{ number: 2, fullName: 'ALI VALIYEV', email: 'ali@gmail.com' }, { number: 3, fullName: 'SAMI KARIMOV', email: 'sami@gmail.com' }];
    const first = await importCertificates(rows);
    assert.equal(first.created.length, 2);
    assert.match(first.created[0].password, /\d/);

    const stored = await Certificate.findOne({ email: 'ali@gmail.com' }).lean();
    assert.ok(stored.shareId && stored.verifyCode && stored.passwordHash && stored.courseTitle);

    const second = await importCertificates(rows.slice(0, 1));
    assert.equal(second.created.length, 0);
    assert.equal(second.errors.length, 1);
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
});
