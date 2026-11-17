// Botsiz sinov: node scripts/demo.js "ILHOMJONOVA MUBINAXON HUSNIDDIN QIZI" intro-gen-ai
const { connectDb, closeDb } = require('../src/db');
const { createCertificate } = require('../src/services/certificates');

(async () => {
  await connectDb();
  const [name = 'ILHOMJONOVA MUBINAXON HUSNIDDIN QIZI', course = 'intro-gen-ai'] = process.argv.slice(2);
  const { cert, password, link } = await createCertificate({ fullName: name, courseSlug: course });
  console.log({ name: cert.fullName, email: cert.email, password, code: cert.verifyCode, link });
  await closeDb();
})().catch((e) => { console.error(e); process.exit(1); });
