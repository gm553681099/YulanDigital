const { Client } = require('pg');

exports.handler = async (event, context) => {
    // 连接数据库（URL将从Netlify后台环境变量读取）
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        // 1. 全自动智能建表（增加精准经纬度字段）
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_points (
                m VARCHAR(50), d VARCHAR(50), c VARCHAR(255), l TEXT, i TEXT, s TEXT, type VARCHAR(20)
            );
            ALTER TABLE audit_points ADD COLUMN IF NOT EXISTS lat FLOAT;
            ALTER TABLE audit_points ADD COLUMN IF NOT EXISTS lng FLOAT;
            
            CREATE TABLE IF NOT EXISTS audit_hotels (
                m VARCHAR(50), checkIn VARCHAR(50), checkOut VARCHAR(50), city VARCHAR(50), district VARCHAR(50), hotel VARCHAR(255), roomNights INT
            );
        `);

        // 2. 如果是超级管理员上传新数据 (POST请求)
        if (event.httpMethod === 'POST') {
            const data = JSON.parse(event.body);
            
            // 清空旧数据
            await client.query('TRUNCATE TABLE audit_points');
            await client.query('TRUNCATE TABLE audit_hotels');

            // 批量存入打卡数据 (增加保存经纬度，保证考勤精准度)
            for (let p of data.points) {
                await client.query(
                    'INSERT INTO audit_points (m, d, c, l, i, s, type, lat, lng) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                    [p.m, p.d, p.c, p.l, p.i || '', p.s || '', p.type, p.exactCoords ? p.exactCoords[0] : null, p.exactCoords ? p.exactCoords[1] : null]
                );
            }
            
            // 批量存入酒店数据
            for (let h of data.hotels) {
                await client.query(
                    'INSERT INTO audit_hotels (m, checkIn, checkOut, city, district, hotel, roomNights) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [h.m, h.checkIn, h.checkOut, h.city, h.district || '', h.hotel, h.roomNights]
                );
            }
            return { statusCode: 200, body: JSON.stringify({ message: '云端同步成功' }) };
        } 
        
        // 3. 如果是普通同事打开网页查看数据 (GET请求)
        else {
            const pointsRes = await client.query('SELECT * FROM audit_points');
            const hotelsRes = await client.query('SELECT * FROM audit_hotels');
            
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: pointsRes.rows, hotels: hotelsRes.rows })
            };
        }
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: '数据库操作失败: ' + error.message }) };
    } finally {
        await client.end();
    }
};