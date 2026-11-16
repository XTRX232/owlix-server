const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.static(path.join(__dirname, 'www')));

const uri = process.env.MONGODB_URI || "mongodb+srv://haneenalhassein232_db_user:jA6iy04RnzMH50Zh@owlix.kno1o42.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);

let db, sessionsCol, locationsCol, settingsCol, liveLocationsCol;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('owlix');
        sessionsCol = db.collection('sessions');
        locationsCol = db.collection('locations');
        settingsCol = db.collection('settings');
        liveLocationsCol = db.collection('liveLocations'); // جدول جديد للموقع المباشر
        console.log('✅ متصل بقاعدة البيانات السحابية');
    } catch(e) { console.error('❌ فشل الاتصال:', e); }
}
connectDB();

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.post('/api/sessions', async (req, res) => {
    const sessionId = crypto.randomBytes(8).toString('hex');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const viewerToken = crypto.randomBytes(16).toString('hex');
    await sessionsCol.insertOne({ id: sessionId, code, viewerToken, status: 'active', createdAt: new Date() });
    res.json({ sessionId, code, viewerToken });
});

app.post('/api/sessions/join', async (req, res) => {
    const { code } = req.body;
    const session = await sessionsCol.findOne({ code, status: 'active' });
    if (!session) return res.status(404).json({ error: 'كود غير صالح' });
    res.json({ sessionId: session.id, token: session.viewerToken });
});

// استقبال الموقع (التحديث المباشر + حفظ السجل كل 15 دقيقة)
app.post('/api/sessions/:id/location', async (req, res) => {
    const { lat, lng, accuracy, speed } = req.body;
    if (lat == null || lng == null) return res.status(400).json({ error: 'إحداثيات مفقودة' });
    
    const now = new Date();
    
    // 1. تحديث الموقع المباشر (للخريطة السلسة)
    await liveLocationsCol.updateOne(
        { sessionId: req.params.id },
        { $set: { lat, lng, accuracy: accuracy || 0, speed: speed || 0, updatedAt: now } },
        { upsert: true }
    );

    // 2. التحقق من حفظ السجل (كل 15 دقيقة)
    const lastSaved = await locationsCol.find({ sessionId: req.params.id }).sort({ recordedAt: -1 }).limit(1).toArray();
    
    let shouldSave = false;
    if (lastSaved.length === 0) {
        shouldSave = true;
    } else {
        const diffMins = (now - lastSaved[0].recordedAt) / 1000 / 60;
        if (diffMins >= 15) shouldSave = true; // إذا مرت 15 دقيقة
    }

    if (shouldSave) {
        await locationsCol.insertOne({ sessionId: req.params.id, lat, lng, accuracy: accuracy || 0, speed: speed || 0, recordedAt: now });
    }

    res.json({ ok: true });
});

// نقطة نهاية جديدة لجلب الموقع المباشر فقط
app.get('/api/sessions/:id/live', async (req, res) => {
    const live = await liveLocationsCol.findOne({ sessionId: req.params.id });
    res.json(live || null);
});

app.get('/api/sessions/:id/history', async (req, res) => {
    const { date } = req.query;
    let query = { sessionId: req.params.id };
    if (date) {
        const start = new Date(date); start.setHours(0,0,0,0);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        query.recordedAt = { $gte: start, $lt: end };
    }
    const points = await locationsCol.find(query).sort({ recordedAt: 1 }).toArray();
    res.json(points);
});

app.delete('/api/sessions/:id', async (req, res) => {
    await sessionsCol.updateOne({ id: req.params.id }, { $set: { status: 'stopped' } });
    res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🦉 OWLIX Server on port ${PORT}`));
