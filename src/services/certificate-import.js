const ExcelJS = require('exceljs');
const { createCertificate, normalizeFullName, courses } = require('./certificates');
const { generateExportPassword } = require('./certificate-export');

const MAX_ROWS = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim();
    if (value.text != null) return cellText(value.text);
    if (value.result != null) return cellText(value.result);
    if (value.hyperlink) return String(value.hyperlink).replace(/^mailto:/i, '').trim();
    return '';
  }
  return String(value).trim();
}

function findColumns(headerRow) {
  let nameColumn = 0;
  let emailColumn = 0;
  headerRow.eachCell((cell, column) => {
    const text = cellText(cell.value).toLowerCase();
    if (!emailColumn && /gmail|e-?mail|pochta/.test(text)) emailColumn = column;
    else if (!nameColumn && /ism|familiya|name|f\.?i\.?sh/.test(text)) nameColumn = column;
  });
  return { nameColumn: nameColumn || 1, emailColumn: emailColumn || 2 };
}

/** Excel faylidan ism-familiya va email qatorlarini o'qiydi. Birinchi qator sarlavha. */
async function parseImportWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: [], ignored: 0 };

  const { nameColumn, emailColumn } = findColumns(sheet.getRow(1));
  const rows = [];
  const errors = [];
  const seen = new Set();
  let ignored = 0;

  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    const fullName = normalizeFullName(cellText(row.getCell(nameColumn).value));
    const email = cellText(row.getCell(emailColumn).value).toLowerCase();
    if (!fullName && !email) continue;
    if (rows.length >= MAX_ROWS) {
      ignored += 1;
      continue;
    }
    if (fullName.length < 3 || !/\p{L}/u.test(fullName)) {
      errors.push(`${number}-qator: ism familiya noto'g'ri`);
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.push(`${number}-qator: email noto'g'ri`);
    } else if (seen.has(email)) {
      errors.push(`${number}-qator: ${email} faylda takrorlangan`);
    } else {
      seen.add(email);
      rows.push({ number, fullName, email });
    }
  }
  return { rows, errors, ignored };
}

/** Qatorlar bo'yicha sertifikat yaratadi. Qolgan maydonlar (kurs, sana, parol, kod, link) avtomatik to'ldiriladi. */
async function importCertificates(rows, creator = {}, onProgress = () => {}) {
  const course = courses[0];
  const created = [];
  const errors = [];
  let done = 0;
  for (const row of rows) {
    const password = generateExportPassword(row.fullName);
    try {
      // eslint-disable-next-line no-await-in-loop
      const { cert } = await createCertificate({
        fullName: row.fullName,
        email: row.email,
        password,
        courseSlug: course.slug,
        telegramId: creator.telegramId,
        username: creator.username,
      });
      created.push({ fullName: cert.fullName, email: cert.email, password, shareId: cert.shareId });
    } catch (e) {
      const message = e.code === 11000 ? 'Bu email bazada mavjud' : e.message;
      errors.push(`${row.number}-qator: ${message}`);
    }
    done += 1;
    onProgress(done);
  }
  return { created, errors };
}

async function createTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Shablon');
  sheet.columns = [
    { header: 'Ism familiya', key: 'fullName', width: 36 },
    { header: 'Gmail', key: 'email', width: 36 },
  ];
  sheet.addRow({ fullName: 'Aliyev Vali', email: 'vali.aliyev@gmail.com' });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0056D2' } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { parseImportWorkbook, importCertificates, createTemplateWorkbook, MAX_ROWS };
