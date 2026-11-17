const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Certificate = require('../models/Certificate');
const courses = require('../data/courses');
const { publicUrl } = require('../config');

const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

/** "Jo`rayeva Imona" -> "jorayeva" ; faqat a-z qoldiriladi */
function slugifyWord(word) {
  return word
    .toLowerCase()
    .split('')
    .map((ch) => (CYRILLIC[ch] !== undefined ? CYRILLIC[ch] : ch))
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

/** Ism-familiyani tozalash: ortiqcha bo'shliqlarni olib tashlash, KATTA harflarga o'tkazish */
function normalizeFullName(raw) {
  return String(raw || '')
    .replace(/[`ʻʼ’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function randomDigits(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += crypto.randomInt(0, 10);
  return s;
}

/** Demo email: familiya.ism + raqam @gmail.com (haqiqiy pochta emas). Bazada noyobligi tekshiriladi. */
async function generateEmail(fullName) {
  const parts = fullName.split(' ').map(slugifyWord).filter(Boolean);
  const base = (parts.slice(0, 2).join('.') || 'student').slice(0, 40);
  for (let attempt = 0; attempt < 20; attempt++) {
    const email = `${base}${randomDigits(attempt < 10 ? 3 : 5)}@gmail.com`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await Certificate.exists({ email }))) return email;
  }
  return `${base}${Date.now()}@gmail.com`;
}

function generatePassword(length = 10) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*'];
  const all = sets.join('');
  const chars = sets.map((set) => set[crypto.randomInt(set.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  // aralashtirish
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateVerifyCode() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 12; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

function shareUrl(cert) {
  return `${publicUrl}/share/${cert.shareId}`;
}

function verifyUrl(cert) {
  return `${publicUrl}/verify/${cert.verifyCode}`;
}

function findCourse(slug) {
  return courses.find((c) => c.slug === slug);
}

/**
 * Yangi sertifikat yaratadi va bazaga saqlaydi.
 * @returns {{ cert, password, link }}
 */
async function createCertificate({ fullName, courseSlug, telegramId, username }) {
  const name = normalizeFullName(fullName);
  if (name.length < 3) throw new Error('Ism-familiya juda qisqa');
  const course = findCourse(courseSlug);
  if (!course) throw new Error('Kurs topilmadi');

  const email = await generateEmail(name);
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const cert = await Certificate.create({
    fullName: name,
    email,
    passwordHash,
    courseSlug: course.slug,
    courseTitle: course.title,
    hours: course.hours,
    completedAt: new Date(),
    shareId: crypto.randomBytes(16).toString('hex'),
    verifyCode: generateVerifyCode(),
    createdBy: { telegramId: telegramId ? String(telegramId) : undefined, username },
  });

  return { cert, password, link: shareUrl(cert) };
}

module.exports = {
  createCertificate,
  normalizeFullName,
  generateEmail,
  generatePassword,
  shareUrl,
  verifyUrl,
  findCourse,
  courses,
};
