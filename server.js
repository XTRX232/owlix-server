const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// 🔥 إضافة صلاحيات CORS للسماح للتطبيق بالاتصال بدون مشاكل
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static(path.join(__dirname, 'www')));

// رابط قاعدة البيانات السحابية (MongoDB)
const uri = process.env.MONGODB_URI || "mongodb+srv://haneenalhassein232_db_user:jA6iy04RnzMH50Zh@owlix.kno1o42.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

let db, sessionsCol, locationsCol, settingsCol;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('owlix');
        sessionsCol = db.collection('sessions');
        locationsCol = db.collection('locations');
        settingsCol = db.collection('settings');
        console.log('✅ متصل بقاعدة البيانات السحابية');
    } catch(e) { console.error('❌ فشل الاتصال:', e); }
}
connectDB();

// فحص الحالة
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 1. إنشاء جلسة جديدة (مشاركة)
app.post('/api/sessions', async (req, res) => {
    const sessionId = crypto.randomBytes(8).toString('hex');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const viewerToken = crypto.randomBytes(16).toString('hex');
    await sessionsCol.insertOne({ id: sessionId, code, viewerToken, status: 'active', createdAt: new Date() });
    res.json({ sessionId, code, viewerToken });
});

// 2. الانضمام لجلسة (متابعة)
app.post('/api/sessions/join', async (req, res) => {
    const { code } = req.body;
    const session = await sessionsCol.findOne({ code, status: 'active' });
    if (!session) return res.status(404).json({ error: 'كود غير صالح' });
    res.json({ sessionId: session.id, token: session.viewerToken });
});

// 3. استقبال إحداثيات جديدة
app.post('/api/sessions/:id/location', async (req, res) => {
    const { lat, lng, accuracy, speed } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ error: 'إحداثيات مفقودة' });
    await locationsCol.insertOne({ sessionId: req.params.id, lat, lng, accuracy: accuracy || 0, speed: speed || 0, recordedAt: new Date() });
    res.json({ ok: true });
});

// 4. جلب السجل (تم تعديله ليجلب كل التاريخ إذا لم يحدد اليوم)
app.get('/api/sessions/:id/history', async (req, res) => {
    const { date } = req.query;
    let query = { sessionId: req.params.id };
    
    // إذا تم تحديد تاريخ، نقوم بفلترة النتائج بذلك اليوم
    if (date) {
        const start = new Date(date); start.setHours(0,0,0,0);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        query.recordedAt = { $gte: start, $lt: end };
    }
    
    try {
        const points = await locationsCol.find(query).sort({ recordedAt: 1 }).toArray();
        res.json(points);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في جلب السجلات' });
    }
});

// 5. إيقاف المشاركة
app.delete('/api/sessions/:id', async (req, res) => {
    await sessionsCol.updateOne({ id: req.params.id }, { $set: { status: 'stopped' } });
    res.json({ ok: true });
});

// 6. الإعدادات
app.get('/api/settings', async (req, res) => {
    let setting = await settingsCol.findOne({ key: 'retention_days' });
    if (!setting) {
        await settingsCol.insertOne({ key: 'retention_days', value: 'forever' });
        setting = { value: 'forever' };
    }
    const count = await locationsCol.countDocuments();
    res.json({ retention_days: setting.value, pointCount: count });
});

app.post('/api/settings/retention', async (req, res) => {
    const { value } = req.body;
    await settingsCol.updateOne({ key: 'retention_days' }, { $set: { value: String(value) } }, { upsert: true });
    res.json({ ok: true });
});

// تشغيل الخادم (متوافق مع Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🦉 OWLIX Server on port ${PORT}`));
