const express = require('express');
const dotenv = require('dotenv');
const DB = require('./configs/database');
// 載入環境變量
dotenv.config();

const PORT = process.env.PORT || 5003;
async function exec() {
    // 連接數據庫
    await DB.connectDB();

    // 創建Express應用
    const app = express();
    // 中間件
    app.use(express.json());

    // 路由
    app.use('/api/order', require('./routes/order'));
    app.listen(PORT, () => console.log(`User Service running on port ${PORT}`));
}
exec()