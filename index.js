// index.js (최종 안정화 버전: CORS/404/로그인/텔레그램 문제 해결)

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const xlsx = require('xlsx'); 
const axios = require('axios');
const FormData = require('form-data'); 
const jwt = require('jsonwebtoken'); 

const Survey = require('./models/Survey');
const Response = require('./models/Response');

const app = express();
const PORT = 5000;

// Render 환경 변수 로드
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'your_super_secret_key_for_jwt';

// ====================================================================
// 1. 미들웨어 설정 (실행 순서 최적화)
// ====================================================================

// 🚨 핵심 수정: CORS 미들웨어를 가장 먼저 호출하여 모든 도메인의 접근을 허용합니다.
app.use(cors()); 

app.use(bodyParser.json());


// 2. MongoDB 데이터베이스 연결
const dbURI = process.env.MONGODB_URI; 
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB 연결 성공'))
    .catch((err) => console.error('❌ MongoDB 연결 실패:', err));


// --- 3. 인증 미들웨어 및 텔레그램 함수 ---
const isAuthenticated = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ message: '접근 권한이 없습니다. (로그인 필요)' });
    }

    try {
        jwt.verify(token, ADMIN_SECRET);
        next(); 
    } catch (err) {
        return res.status(401).json({ message: '접근 권한이 유효하지 않습니다. 다시 로그인해 주세요.' });
    }
};

// 💡 텔레그램 알림 함수 (서버 충돌 방지 로직 포함)
async function sendTelegramAlert(message) {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!telegramToken || !chatId) {
        console.warn("⚠️ 텔레그램 알림 환경 변수가 설정되지 않았습니다.");
        return; 
    }
    try {
        await axios.post(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error("🔥 텔레그램 알림 전송 실패:", error.response ? error.response.data : error.message);
    }
}


// ====================================================================
// 4. API 라우트 정의
// ====================================================================

// 💡 1. 관리자 로그인
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = process.env.ADMIN_USER;
    const ADMIN_PASS = process.env.ADMIN_PASS;

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ username: ADMIN_USER }, ADMIN_SECRET, { expiresIn: '1h' });
        return res.json({ message: '로그인 성공', token: token });
    } else {
        return res.status(401).json({ message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
    }
});


// 💡 2. 최신 설문지 ID 조회 (도메인 최상위 주소용)
app.get('/api/latest-survey', async (req, res) => {
    try {
        const latestSurvey = await Survey.findOne({})
            .sort({ createdAt: -1 })
            .limit(1);

        if (!latestSurvey) { return res.status(404).json({ message: '아직 생성된 설문지가 없습니다.' }); }
        res.json({ surveyId: latestSurvey._id });
    } catch (error) {
        res.status(500).json({ message: '최신 설문지 ID 조회 실패' });
    }
});


// ----------------------------------------------------------------------
// 🚨 관리자 API: 모두 isAuthenticated 적용
// ----------------------------------------------------------------------

app.post('/api/surveys', isAuthenticated, async (req, res) => { /* 설문지 생성 */
    try {
        const newSurvey = new Survey(req.body);
        const savedSurvey = await newSurvey.save();
        res.status(201).json(savedSurvey);
    } catch (error) { res.status(500).json({ message: '설문지 생성에 실패했습니다.', error: error.message }); }
});

app.get('/api/surveys', isAuthenticated, async (req, res) => { /* 모든 설문지 목록 조회 */
    try {
        const surveys = await Survey.find().sort({ createdAt: -1 });
        res.json(surveys);
    } catch (error) { res.status(500).json({ message: '설문지 목록을 가져오는 데 실패했습니다.' }); }
});

app.delete('/api/surveys/:id', isAuthenticated, async (req, res) => { /* 설문지 삭제 */
    try {
        await Response.deleteMany({ surveyId: req.params.id }); 
        const result = await Survey.findByIdAndDelete(req.params.id);
        if (!result) { return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' }); }
        res.json({ message: `[${result.title}] 설문지와 관련 응답이 성공적으로 삭제되었습니다.` });
    } catch (error) { res.status(500).json({ message: '설문지 삭제에 실패했습니다.' }); }
});

app.get('/api/surveys/:id/export', isAuthenticated, async (req, res) => { /* 텔레그램 엑셀 전송 */
    try {
        const survey = await Survey.findById(req.params.id);
        const responses = await Response.find({ surveyId: req.params.id }).sort({ submittedAt: 1 });
        if (responses.length === 0) { return res.status(400).json({ message: '이 설문지에는 응답이 없어 엑셀을 생성할 수 없습니다.' }); }
        
        // 엑셀 생성 로직
        const headers = ['제출 시간', '이름', '전화번호', ...survey.questions.map(q => q.text)];
        const data = [headers]; 
        
        responses.forEach(r => {
            const row = [
                new Date(r.submittedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
                r.name,
                r.phone
            ];
            const answerMap = new Map(r.answers.map(a => [a.questionText, a.value]));
            survey.questions.forEach(q => {
                row.push(answerMap.get(q.text) || '');
            });
            data.push(row);
        });

        const ws = xlsx.utils.aoa_to_sheet(data); 
        const wb = xlsx.utils.book_new();
        const filename = `${survey.title}_응답보고서.xlsx`;
        xlsx.utils.book_append_sheet(wb, ws, '설문응답');
        const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });


        // 텔레그램 파일 전송 로직
        const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const captionText = `🔔 설문 응답 보고서: [${survey.title}]\n총 ${responses.length}개의 응답이 접수되었습니다.`;
        
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', captionText);
        
        // 버퍼를 파일로 직접 첨부 (안정화)
        formData.append('document', excelBuffer, { 
            filename: filename, 
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        });
        
        await axios.post(`https://api.telegram.org/bot${telegramToken}/sendDocument`, formData, {
            headers: formData.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        res.status(200).json({ message: '엑셀 보고서가 텔레그램으로 성공적으로 전송되었습니다.' });

    } catch (error) {
        console.error('🔥 엑셀/텔레그램 전송 오류:', error.response ? error.response.data : error.message);
        res.status(500).json({ message: '서버 오류가 발생했습니다. (텔레그램 전송 로직 충돌)' });
    }
});


// ----------------------------------------------------------------------
// 🌐 사용자 API: 인증 미들웨어 적용 안 함
// ----------------------------------------------------------------------

app.get('/api/surveys/:id', async (req, res) => { /* 특정 설문지 1개 조회 */
    try {
        const survey = await Survey.findById(req.params.id);
        if (!survey) { return res.status(404).json({ message: '설문지를 찾을 수 없습니다.' }); }
        res.json(survey);
    } catch (error) { res.status(500).json({ message: '설문지 정보를 가져오는 데 실패했습니다.' }); }
});

app.post('/api/responses', async (req, res) => { /* 설문 응답 제출 */
    try {
        const { surveyId, name, phone, answers } = req.body;
        
        // 💡 텔레그램 알림을 위한 survey 정보 로드
        const survey = await Survey.findById(surveyId);
        if (!survey) { return res.status(404).json({ message: '존재하지 않는 설문지 ID입니다.' }); }
        
        const existingResponse = await Response.findOne({ surveyId, phone });
        if (existingResponse) { return res.status(409).json({ message: '이미 이 설문에 참여한 전화번호입니다.' }); }

        const newResponse = new Response({ surveyId, name, phone, answers });
        await newResponse.save();
        
        // 텔레그램 알림 전송 (비동기 처리)
        sendTelegramAlert(`🔔 새 응답 도착! 설문: ${survey.title}\n응답자: ${name} (${phone})`).catch(console.error); 
        
        res.status(201).json({ message: '소중한 의견 감사합니다. 응답이 성공적으로 제출되었습니다.' });

    } catch (error) {
        console.error('응답 제출 오류:', error);
        if (error.code === 11000) {
             return res.status(409).json({ message: '이미 이 설문에 참여한 전화번호입니다.' });
        }
        res.status(500).json({ message: '응답 제출에 실패했습니다.' });
    }
});


// ====================================================================
// 5. 정적 파일 제공 (호환성 확보를 위해 라우트 뒤에 위치)
// ====================================================================
// 🚨 404 오류 해결: 모든 API 라우트를 처리한 후, 나머지 요청(HTML, CSS, JS)만 이 코드가 처리합니다.
app.use(express.static('.')); 


// 6. 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});