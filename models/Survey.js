// models/Survey.js (최종 버전)
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const QuestionSchema = new Schema({
    text: { type: String, required: true },
    type: { 
        type: String, 
        required: true, 
        enum: ['text', 'choice', 'rating', 'dropdown'] // 드롭다운 포함
    },
    options: [{ type: String }]
});

const SurveySchema = new Schema({
    title: { type: String, required: true },
    description: { type: String },
    questions: [QuestionSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Survey', SurveySchema);