const WebSocket = require('ws');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static(__dirname));
app.use(express.json());

// Create database if it doesn't exist
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database.');
        
        // Create tables if they don't exist
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS blocked_devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT UNIQUE NOT NULL,
            device_id TEXT,
            reason TEXT,
            blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reported_user_id TEXT NOT NULL,
            reported_ip TEXT NOT NULL,
            reporter_user_id TEXT NOT NULL,
            reporter_ip TEXT NOT NULL,
            reason TEXT NOT NULL,
            details TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS online_users (
            socket_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            device_id TEXT,
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id TEXT NOT NULL,
            receiver_id TEXT NOT NULL,
            message TEXT NOT NULL,
            encrypted INTEGER DEFAULT 1,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        console.log('✅ Database tables created/verified.');
    }
});

// Create HTTP server
const server = require('http').createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server, 
    perMessageDeflate: false,
    maxPayload: 1048576 // 1MB
});

// Store connected clients
const clients = new Map();
const waitingUsers = [];
const userPairs = new Map();

// Function to get client IP
function getClientIP(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips = xForwardedFor.split(',');
        return ips[0].trim();
    }
    return req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           req.connection.socket.remoteAddress;
}

// Generate device ID from headers
function generateDeviceId(req) {
    const userAgent = req.headers['user-agent'] || '';
    const accept = req.headers['accept'] || '';
    const language = req.headers['accept-language'] || '';
    const encoding = req.headers['accept-encoding'] || '';
    
    const deviceString = `${userAgent}${accept}${language}${encoding}`;
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < deviceString.length; i++) {
        const char = deviceString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

// Check if device is blocked
function isDeviceBlocked(ip, deviceId, callback) {
    db.get('SELECT * FROM blocked_devices WHERE ip_address = ? OR device_id = ?', 
        [ip, deviceId], 
        (err, row) => {
            callback(err, !!row);
        }
    );
}

// Add user to database
function addUserToDB(userId, username, ip, deviceId) {
    db.run(`INSERT OR REPLACE INTO users (id, username, ip_address, last_seen) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, 
            [userId, username, ip]);
    
    console.log(`✅ User added/updated in DB: ${username} (${ip})`);
}

// Add online user to database
function addOnlineUser(socketId, userId, username, ip, deviceId) {
    db.run(`INSERT OR REPLACE INTO online_users (socket_id, user_id, username, ip_address, device_id) 
            VALUES (?, ?, ?, ?, ?)`, 
            [socketId, userId, username, ip, deviceId]);
}

// Remove online user from database
function removeOnlineUser(socketId) {
    db.run('DELETE FROM online_users WHERE socket_id = ?', [socketId]);
}

// Get online count
function getOnlineCount(callback) {
    db.get('SELECT COUNT(DISTINCT ip_address) as count FROM online_users', (err, row) => {
        callback(err, row ? row.count : 0);
    });
}

// Get all online users
function getAllOnlineUsers(callback) {
    db.all('SELECT * FROM online_users ORDER BY joined_at DESC', (err, rows) => {
        callback(err, rows || []);
    });
}

// Add report
function addReport(reportedUserId, reportedIP, reporterUserId, reporterIP, reason, details) {
    db.run(`INSERT INTO reports (reported_user_id, reported_ip, reporter_user_id, reporter_ip, reason, details) 
            VALUES (?, ?, ?, ?, ?, ?)`, 
            [reportedUserId, reportedIP, reporterUserId, reporterIP, reason, details]);
    console.log(`📢 Report added for user: ${reportedUserId}`);
}

// Block device
function blockDevice(ip, deviceId, reason) {
    db.run(`INSERT OR REPLACE INTO blocked_devices (ip_address, device_id, reason) 
            VALUES (?, ?, ?)`, 
            [ip, deviceId, reason]);
    console.log(`🚫 Device blocked: ${ip}`);
    
    // Notify all clients with this IP
    clients.forEach((client, socketId) => {
        if ((client.ip === ip || client.deviceId === deviceId) && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'blocked',
                message: 'Your device has been blocked from using this service.'
            }));
            setTimeout(() => client.ws.close(), 1000);
        }
    });
}

// Unblock device
function unblockDevice(ip) {
    db.run('DELETE FROM blocked_devices WHERE ip_address = ?', [ip], function(err) {
        if (err) {
            console.error('Error unblocking device:', err);
        } else {
            console.log(`✅ Device unblocked: ${ip}`);
        }
    });
}

// Get all reports
function getAllReports(callback) {
    db.all('SELECT * FROM reports ORDER BY created_at DESC', (err, rows) => {
        callback(err, rows || []);
    });
}

// Get all blocked devices
function getAllBlockedDevices(callback) {
    db.all('SELECT * FROM blocked_devices ORDER BY blocked_at DESC', (err, rows) => {
        callback(err, rows || []);
    });
}

// Update report status
function updateReportStatus(id, status) {
    db.run('UPDATE reports SET status = ? WHERE id = ?', [status, id]);
}

// Get total users count
function getTotalUsers(callback) {
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        callback(err, row ? row.count : 0);
    });
}

// Get database size
function getDBSize(callback) {
    fs.stat('./database.db', (err, stats) => {
        if (err) {
            callback(err, null);
        } else {
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            callback(null, `${sizeMB} MB`);
        }
    });
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const clientIP = getClientIP(req).replace('::ffff:', '').replace('::1', '127.0.0.1');
    const deviceId = generateDeviceId(req);
    
    console.log(`🔗 New client connected: ${clientId} from ${clientIP}`);
    
    // Check if device is blocked
    isDeviceBlocked(clientIP, deviceId, (err, blocked) => {
        if (blocked) {
            ws.send(JSON.stringify({
                type: 'blocked',
                message: 'Your device has been blocked from using this service.'
            }));
            setTimeout(() => ws.close(), 1000);
            return;
        }
        
        // Store client information
        const client = {
            id: clientId,
            ws: ws,
            ip: clientIP,
            deviceId: deviceId,
            username: null,
            partner: null,
            room: null,
            streams: {
                video: false,
                audio: false
            }
        };
        
        clients.set(clientId, client);
        
        // Send online count
        getOnlineCount((err, count) => {
            if (!err) {
                ws.send(JSON.stringify({
                    type: 'onlineCount',
                    count: count
                }));
            }
        });
        
        // Handle messages from client
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                handleClientMessage(clientId, data);
            } catch (error) {
                console.error('❌ Error parsing message:', error);
            }
        });
        
        // Handle client disconnect
        ws.on('close', () => {
            console.log(`🔌 Client disconnected: ${clientId}`);
            
            // Remove from waiting list
            const waitingIndex = waitingUsers.indexOf(clientId);
            if (waitingIndex > -1) {
                waitingUsers.splice(waitingIndex, 1);
            }
            
            // Notify partner if paired
            const client = clients.get(clientId);
            if (client && client.partner) {
                const partnerId = client.partner;
                const partner = clients.get(partnerId);
                
                if (partner) {
                    partner.partner = null;
                    partner.ws.send(JSON.stringify({
                        type: 'partnerDisconnected',
                        message: 'Your partner has disconnected.'
                    }));
                    
                    // Add partner back to waiting list
                    if (partner.username) {
                        waitingUsers.push(partnerId);
                        partner.ws.send(JSON.stringify({
                            type: 'searching',
                            message: 'Searching for new partner...'
                        }));
                    }
                }
                
                // Remove from pairs
                userPairs.delete(clientId);
                userPairs.delete(partnerId);
            }
            
            // Remove from database
            removeOnlineUser(clientId);
            
            // Remove from clients map
            clients.delete(clientId);
            
            // Update online count for all
            broadcastOnlineCount();
        });
        
        ws.on('error', (error) => {
            console.error(`⚠️ WebSocket error for client ${clientId}:`, error);
        });
        
        // Send ping every 30 seconds to keep connection alive
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);
        
        ws.on('pong', () => {
            // Connection is alive
        });
    });
});

// Handle client messages
function handleClientMessage(clientId, data) {
    const client = clients.get(clientId);
    if (!client) return;
    
    console.log(`📨 Message from ${clientId}: ${data.type}`);
    
    switch (data.type) {
        case 'join':
            if (!data.username || data.username.trim() === '') {
                client.ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Please enter a display name'
                }));
                return;
            }
            
            client.username = data.username.trim().substring(0, 20);
            
            // Add to database
            addUserToDB(clientId, client.username, client.ip, client.deviceId);
            addOnlineUser(clientId, clientId, client.username, client.ip, client.deviceId);
            
            console.log(`👤 ${client.username} joined from ${client.ip}`);
            
            client.ws.send(JSON.stringify({
                type: 'joined',
                username: client.username,
                message: 'Successfully joined chat'
            }));
            break;
            
        case 'findPartner':
            if (!client.username) {
                client.ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Please set a username first'
                }));
                return;
            }
            
            // Add to waiting list if not already
            if (!waitingUsers.includes(clientId) && !client.partner) {
                waitingUsers.push(clientId);
                console.log(`🔍 ${client.username} is waiting for a partner`);
                
                client.ws.send(JSON.stringify({
                    type: 'searching',
                    message: 'Looking for someone to chat with...'
                }));
            }
            
            // Try to match
            matchUsers();
            break;
            
        case 'nextPerson':
            client.ws.send(JSON.stringify({
                type: 'searching',
                message: 'Finding next person...'
            }));
            
            if (client.partner) {
                // Notify partner
                const partner = clients.get(client.partner);
                if (partner) {
                    partner.partner = null;
                    partner.ws.send(JSON.stringify({
                        type: 'partnerDisconnected',
                        message: 'Partner disconnected'
                    }));
                    
                    // Add partner back to waiting list
                    if (partner.username) {
                        waitingUsers.push(client.partner);
                        partner.ws.send(JSON.stringify({
                            type: 'searching',
                            message: 'Searching for new partner...'
                        }));
                    }
                }
                
                // Remove from pairs
                userPairs.delete(clientId);
                userPairs.delete(client.partner);
                client.partner = null;
            }
            
            // Add back to waiting list
            if (client.username && !waitingUsers.includes(clientId)) {
                waitingUsers.push(clientId);
            }
            
            // Try to match immediately
            matchUsers();
            break;
            
        case 'leave':
            // Client is leaving voluntarily
            if (client.partner) {
                const partner = clients.get(client.partner);
                if (partner) {
                    partner.ws.send(JSON.stringify({
                        type: 'partnerDisconnected',
                        message: 'Partner left the chat'
                    }));
                    partner.partner = null;
                    
                    // Add partner back to waiting list
                    if (partner.username) {
                        waitingUsers.push(client.partner);
                    }
                }
                
                userPairs.delete(clientId);
                userPairs.delete(client.partner);
            }
            
            // Remove from waiting list
            const waitingIndex = waitingUsers.indexOf(clientId);
            if (waitingIndex > -1) {
                waitingUsers.splice(waitingIndex, 1);
            }
            
            client.partner = null;
            break;
            
        case 'offer':
        case 'answer':
        case 'iceCandidate':
            // Forward WebRTC signaling messages to partner
            if (client.partner) {
                const partner = clients.get(client.partner);
                if (partner && partner.ws.readyState === WebSocket.OPEN) {
                    const forwardData = { ...data };
                    forwardData.from = clientId;
                    console.log(`📤 Forwarding ${data.type} from ${clientId} to ${client.partner}`);
                    partner.ws.send(JSON.stringify(forwardData));
                } else {
                    client.ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Partner not connected'
                    }));
                }
            } else {
                client.ws.send(JSON.stringify({
                    type: 'error',
                    message: 'No partner connected'
                }));
            }
            break;
            
        case 'message':
            // Forward chat message to partner
            if (client.partner) {
                const partner = clients.get(client.partner);
                if (partner && partner.ws.readyState === WebSocket.OPEN) {
                    // Simple encryption (XOR with key 123)
                    const encryptedMessage = encryptMessage(data.message, 123);
                    
                    partner.ws.send(JSON.stringify({
                        type: 'message',
                        message: encryptedMessage,
                        from: client.username,
                        timestamp: new Date().toISOString()
                    }));
                    
                    // Save to database
                    db.run(`INSERT INTO messages (sender_id, receiver_id, message, encrypted) 
                           VALUES (?, ?, ?, 1)`, 
                           [clientId, client.partner, encryptedMessage]);
                }
            }
            break;
            
        case 'streamStatus':
            // Update client stream status
            if (data.video !== undefined) client.streams.video = data.video;
            if (data.audio !== undefined) client.streams.audio = data.audio;
            break;
            
        case 'report':
            // Handle user report
            if (client.partner) {
                const partner = clients.get(client.partner);
                if (partner) {
                    addReport(
                        client.partner,
                        partner.ip,
                        clientId,
                        client.ip,
                        data.reason,
                        data.details
                    );
                    
                    client.ws.send(JSON.stringify({
                        type: 'reported',
                        message: 'User reported successfully. Finding new partner...'
                    }));
                    
                    // Auto block after 3 reports
                    db.get('SELECT COUNT(*) as count FROM reports WHERE reported_user_id = ?', 
                        [client.partner], 
                        (err, row) => {
                            if (row && row.count >= 3) {
                                blockDevice(partner.ip, partner.deviceId, 
                                    'Auto-blocked after 3 reports');
                            }
                        });
                    
                    // Find next person
                    handleClientMessage(clientId, { type: 'nextPerson' });
                }
            }
            break;
            
        case 'getOnlineCount':
            getOnlineCount((err, count) => {
                if (!err) {
                    client.ws.send(JSON.stringify({
                        type: 'onlineCount',
                        count: count
                    }));
                }
            });
            break;
            
        case 'ping':
            client.ws.send(JSON.stringify({ type: 'pong' }));
            break;
    }
}

// Simple encryption function
function encryptMessage(message, key) {
    let encrypted = '';
    for (let i = 0; i < message.length; i++) {
        encrypted += String.fromCharCode(message.charCodeAt(i) ^ key);
    }
    return btoa(encrypted); // Base64 encode
}

// Match users from waiting list
function matchUsers() {
    console.log(`🔍 Matching users... Waiting: ${waitingUsers.length}`);
    
    while (waitingUsers.length >= 2) {
        const user1Id = waitingUsers.shift();
        const user2Id = waitingUsers.shift();
        
        const user1 = clients.get(user1Id);
        const user2 = clients.get(user2Id);
        
        if (user1 && user2 && 
            user1.ws.readyState === WebSocket.OPEN && 
            user2.ws.readyState === WebSocket.OPEN &&
            !user1.partner && !user2.partner) {
            
            // Pair them
            user1.partner = user2Id;
            user2.partner = user1Id;
            
            // Store pair
            userPairs.set(user1Id, user2Id);
            userPairs.set(user2Id, user1Id);
            
            // Notify both users
            user1.ws.send(JSON.stringify({
                type: 'matched',
                partner: {
                    id: user2Id,
                    username: user2.username
                },
                message: `Connected with ${user2.username}`
            }));
            
            user2.ws.send(JSON.stringify({
                type: 'matched',
                partner: {
                    id: user1Id,
                    username: user1.username
                },
                message: `Connected with ${user1.username}`
            }));
            
            console.log(`🤝 Matched ${user1.username} with ${user2.username}`);
            
        } else {
            // If one user is no longer available, put the other back in waiting
            if (user1 && user1.ws.readyState === WebSocket.OPEN && !user1.partner) {
                waitingUsers.push(user1Id);
                user1.ws.send(JSON.stringify({
                    type: 'searching',
                    message: 'Still searching for partner...'
                }));
            }
            if (user2 && user2.ws.readyState === WebSocket.OPEN && !user2.partner) {
                waitingUsers.push(user2Id);
                user2.ws.send(JSON.stringify({
                    type: 'searching',
                    message: 'Still searching for partner...'
                }));
            }
        }
    }
}

// Broadcast online count to all clients
function broadcastOnlineCount() {
    getOnlineCount((err, count) => {
        if (!err) {
            const countMessage = JSON.stringify({
                type: 'onlineCount',
                count: count
            });
            
            clients.forEach((client) => {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(countMessage);
                }
            });
        }
    });
}

// Admin API endpoints (with authentication)
const ADMIN_CREDENTIALS = {
    username: 'FOUNDER@OFFICIAL',
    password: '@nitishraj2645#'
};

// Admin authentication middleware
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    
    const [type, credentials] = authHeader.split(' ');
    if (type !== 'Basic') {
        return res.status(401).json({ success: false, message: 'Invalid authentication type' });
    }
    
    const [username, password] = Buffer.from(credentials, 'base64').toString().split(':');
    
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
}

// Admin login endpoint
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        // Generate session token
        const token = Buffer.from(`${username}:${password}`).toString('base64');
        res.json({
            success: true,
            token: token,
            message: 'Login successful'
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Invalid credentials'
        });
    }
});

// Protected admin endpoints
app.get('/admin/data', authenticateAdmin, (req, res) => {
    // Get all data for admin panel
    Promise.all([
        new Promise(resolve => getTotalUsers((err, count) => resolve(count))),
        new Promise(resolve => getOnlineCount((err, count) => resolve(count))),
        new Promise(resolve => getAllReports((err, reports) => resolve(reports || []))),
        new Promise(resolve => getAllBlockedDevices((err, blocked) => resolve(blocked || []))),
        new Promise(resolve => getAllOnlineUsers((err, online) => resolve(online || []))),
        new Promise(resolve => getDBSize((err, size) => resolve(size)))
    ])
    .then(([totalUsers, onlineUsers, reports, blocked, online, dbSize]) => {
        res.json({
            success: true,
            totalUsers,
            onlineUsers,
            totalReports: reports.length,
            blockedUsers: blocked.length,
            reports,
            blocked,
            online,
            dbSize,
            serverTime: new Date().toISOString()
        });
    })
    .catch(error => {
        console.error('Error fetching admin data:', error);
        res.status(500).json({ success: false, message: 'Error fetching admin data' });
    });
});

app.post('/admin/block', authenticateAdmin, (req, res) => {
    const { ip, deviceId, reason } = req.body;
    
    if (!ip) {
        return res.json({ success: false, message: 'IP address required' });
    }
    
    blockDevice(ip, deviceId, reason || 'Blocked by admin');
    res.json({ success: true, message: `IP ${ip} blocked successfully` });
});

app.post('/admin/unblock', authenticateAdmin, (req, res) => {
    const { ip } = req.body;
    
    if (!ip) {
        return res.json({ success: false, message: 'IP address required' });
    }
    
    unblockDevice(ip);
    res.json({ success: true, message: `IP ${ip} unblocked` });
});

app.post('/admin/update-report', authenticateAdmin, (req, res) => {
    const { id, status } = req.body;
    
    if (!id || !status) {
        return res.json({ success: false, message: 'ID and status required' });
    }
    
    updateReportStatus(id, status);
    res.json({ success: true, message: 'Report updated' });
});

// Serve main HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API endpoint to get server info
app.get('/api/server-info', (req, res) => {
    res.json({
        name: 'BLACK 🖤 ENTHEM',
        developer: 'Nitish Sharma',
        version: '2.0.0',
        uptime: process.uptime(),
        connections: clients.size,
        waiting: waitingUsers.length
    });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Main page: http://localhost:${PORT}`);
    console.log(`🔧 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`👨‍💻 Developer: Nitish Sharma`);
    console.log(`⚡ Powered by BLACK 🖤 ENTHEM`);
    console.log('\n📡 Network URLs:');
    console.log(`   Local: http://localhost:${PORT}`);
    console.log(`   Network: http://${getNetworkIP()}:${PORT}`);
});

// Get network IP
function getNetworkIP() {
    const interfaces = require('os').networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Clean up online users periodically
setInterval(() => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.run('DELETE FROM online_users WHERE joined_at < ?', [tenMinutesAgo]);
    
    // Update online count
    broadcastOnlineCount();
}, 5 * 60 * 1000);

// Auto-match users every 5 seconds
setInterval(() => {
    if (waitingUsers.length >= 2) {
        matchUsers();
    }
}, 5000);

// Log server status every minute
setInterval(() => {
    console.log(`📊 Status: ${clients.size} clients, ${waitingUsers.length} waiting`);
}, 60000);