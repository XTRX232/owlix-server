const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'www')));

// 🔴 ضع رابط قاعدة البيانات هنا (من MongoDB Atlas)
const uri = process.env.MONGODB_URI || "mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

let db, sessionsCol, locationsCol, settingsCol;

async function connectDB() {
    await client.connect();
    db = client.db('owlix');
    sessionsCol = db.collection('sessions');
    locationsCol = db.collection('locations');
    settingsCol = db.collection('settings');
    console.log('✅ متصل بقاعدة البيانات السحابية');
}
connectDB().catch(console.error);

// 1. فحص الحالة
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 2. إنشاء جلسة جديدة
app.post('/api/sessions', async (req, res) => {
    const sessionId = crypto.randomBytes(8).toString('hex');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const viewerToken = crypto.randomBytes(16).toString('hex');
    
    await sessionsCol.insertOne({ id: sessionId, code, viewerToken, status: 'active', createdAt: new Date() });
    res.json({ sessionId, code, viewerToken });
});

// 3. الانضمام لجلسة
app.post('/api/sessions/join', async (req, res) => {
    const { code } = req.body;
    const session = await sessionsCol.findOne({ code, status: 'active' });
    if (!session) return res.status(404).json({ error: 'كود غير صالح' });
    res.json({ sessionId: session.id, token: session.viewerToken });
});

// 4. استقبال نقطة موقع
app.post('/api/sessions/:id/location', async (req, res) => {
    const { lat, lng, accuracy, speed } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ error: 'إحداثيات مفقودة' });

    await locationsCol.insertOne({
        sessionId: req.params.id, lat, lng, accuracy: accuracy || 0, speed: speed || 0, recordedAt: new Date()
    });
    res.json({ ok: true });
});

// 5. جلب السجل
app.get('/api/sessions/:id/history', async (req, res) => {
    const { date } = req.query;
    const start = date ? new Date(date) : new Date();
    start.setHours(0,0,0,0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const points = await locationsCol.find({
        sessionId: req.params.id,
        recordedAt: { $gte: start, $lt: end }
    }).sort({ recordedAt: 1 }).toArray();
    
    res.json(points);
});

// 6. إيقاف المشاركة
app.delete('/api/sessions/:id', async (req, res) => {
    await sessionsCol.updateOne({ id: req.params.id }, { $set: { status: 'stopped' } });
    res.json({ ok: true });
});

// 7. الإعدادات
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🦉 OWLIX Server on port ${PORT}`));
