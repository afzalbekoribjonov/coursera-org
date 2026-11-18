const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { shareUrl } = require('./certificates');

function generateExportPassword(fullName) {
  const nameCharacters = Array.from(String(fullName || '').toLocaleLowerCase().replace(/[^\p{L}]/gu, ''));
  const seed = nameCharacters.length ? nameCharacters : Array.from('student');
  const passwordCharacters = Array.from({ length: 7 }, (_, index) => seed[index % seed.length]);
  passwordCharacters.splice(crypto.randomInt(passwordCharacters.length + 1), 0, String(crypto.randomInt(10)));
  return passwordCharacters.join('');
}

async function createCertificatesWorkbook(certificates) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Learn';
  const sheet = workbook.addWorksheet('Sertifikatlar', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: '№', key: 'number', width: 8 },
    { header: 'Ism familiya', key: 'fullName', width: 36 },
    { header: 'Email', key: 'email', width: 36 },
    { header: 'Parol', key: 'password', width: 20 },
    { header: 'Sertifikat Link', key: 'certificateLink', width: 64 },
  ];

  certificates.forEach((certificate, index) => {
    sheet.addRow({
      number: index + 1,
      fullName: certificate.fullName,
      email: certificate.email,
      password: certificate.password || generateExportPassword(certificate.fullName),
      certificateLink: shareUrl(certificate),
    });
  });

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0056D2' } };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.autoFilter = { from: 'A1', to: 'E1' };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'middle' };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { createCertificatesWorkbook, generateExportPassword };
