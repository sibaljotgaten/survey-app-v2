// models/Response.js (최종 버전)
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AnswerSchema = new Schema({
    questionText: { type: String, required: true },
    value: { type: String, required: true }
});

const ResponseSchema = new Schema({
    surveyId: { type: Schema.Types.ObjectId, ref: 'Survey', required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    answers: [AnswerSchema],
    submittedAt: { type: Date, default: Date.now }
});

ResponseSchema.index({ surveyId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('Response', ResponseSchema);