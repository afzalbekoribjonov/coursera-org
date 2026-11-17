const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },

    courseSlug: { type: String, required: true },
    courseTitle: { type: String, required: true },
    hours: { type: Number, default: 1 },
    completedAt: { type: Date, default: Date.now },

    // /share/<shareId> — 32 belgili hex
    shareId: { type: String, required: true, unique: true, index: true },
    // /verify/<verifyCode> — 12 belgili kod (sertifikatda yoziladi)
    verifyCode: { type: String, required: true, unique: true, index: true },

    createdBy: {
      telegramId: String,
      username: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Certificate', certificateSchema);
