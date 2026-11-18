const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { createCertificatesWorkbook, generateExportPassword } = require('./certificate-export');

test('export passwords contain seven name-based letters and one random digit', () => {
  const password = generateExportPassword('Imona Jo‘rayeva');
  const nameLetters = new Set(Array.from('imonajorayeva'));

  assert.equal(Array.from(password).length, 8);
  assert.match(password, /\d/);
  assert.equal(Array.from(password).filter((character) => /\d/.test(character)).length, 1);
  assert.ok(Array.from(password).filter((character) => !/\d/.test(character)).every((character) => nameLetters.has(character)));
});

test('certificate export creates the requested columns and all rows', async () => {
  const buffer = await createCertificatesWorkbook([
    { fullName: 'IMONA JO‘RAYEVA', email: 'imona@example.com', shareId: 'share-1' },
    { fullName: 'ALI VALIYEV', email: 'ali@example.com', shareId: 'share-2' },
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Sertifikatlar');

  assert.deepEqual(sheet.getRow(1).values.slice(1), ['№', 'Ism familiya', 'Email', 'Parol', 'Sertifikat Link']);
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getRow(2).getCell(1).value, 1);
  assert.equal(sheet.getRow(2).getCell(2).value, 'IMONA JO‘RAYEVA');
  assert.equal(sheet.getRow(2).getCell(3).value, 'imona@example.com');
  assert.equal(sheet.getRow(2).getCell(5).value.endsWith('/share/share-1'), true);
});
