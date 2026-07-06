const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let discordClient = null;
let voiceChannelId = process.env.VOICE_CHANNEL_ID || null;
let discordToken = process.env.DISCORD_TOKEN || null;
let botRunning = false;
let logs = [];

function log(message) {
    const timestamp = new Date().toLocaleString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(logEntry);
    logs.push(logEntry);
    if (logs.length > 100) {
        logs.shift();
    }
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'log', message: logEntry }));
        }
    });
}

async function startBot() {
    if (botRunning) {
        log('الحساب متصل بالفعل.');
        return;
    }

    if (!discordToken) {
        log('خطأ: لم يتم توفير Discord Token.');
        return;
    }

    if (!voiceChannelId) {
        log('خطأ: لم يتم توفير معرف الغرفة الصوتية (Voice Channel ID).');
        return;
    }

    discordClient = new Client({
        checkUpdate: false,
    });

    discordClient.on('ready', async () => {
        log(`تم تسجيل الدخول بنجاح كـ ${discordClient.user.tag}!`);
        botRunning = true;
        await joinVoiceChannel(voiceChannelId);
    });

    discordClient.on('voiceStateUpdate', (oldState, newState) => {
        if (newState.id === discordClient.user.id && oldState.channelId === voiceChannelId && newState.channelId === null) {
            log('تم فصل الحساب من الغرفة الصوتية. محاولة إعادة الاتصال بعد 10 ثوانٍ...');
            setTimeout(() => joinVoiceChannel(voiceChannelId), 10000);
        }
    });

    discordClient.on('error', (error) => {
        log(`خطأ في الحساب: ${error.message}`);
        stopBot();
    });

    try {
        await discordClient.login(discordToken);
    } catch (error) {
        log(`فشل تسجيل الدخول: ${error.message}`);
        botRunning = false;
    }
}

async function joinVoiceChannel(channelId) {
    if (!discordClient || !discordClient.isReady()) {
        log('عميل Discord غير جاهز للاتصال.');
        return;
    }

    try {
        const channel = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.isVoice()) {
            log(`خطأ: الغرفة الصوتية بالمعرف ${channelId} غير موجودة أو ليست غرفة صوتية.`);
            return;
        }

        const connection = await channel.join({
            selfMute: true,
            selfDeaf: false,
            video: false
        });
        
        log(`تم الانضمام إلى الغرفة الصوتية: ${channel.name}`);
    } catch (error) {
        log(`فشل الانضمام إلى الغرفة الصوتية: ${error.message}`);
        log('محاولة إعادة الاتصال بعد 10 ثوانٍ...');
        setTimeout(() => joinVoiceChannel(channelId), 10000);
    }
}

function stopBot() {
    if (!botRunning) {
        log('الحساب غير متصل.');
        return;
    }

    if (discordClient) {
        discordClient.destroy();
        discordClient = null;
    }
    botRunning = false;
    log('تم قطع الاتصال.');
}

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'init', logs: logs, botRunning: botRunning, voiceChannelId: voiceChannelId, discordToken: discordToken ? '********' : '' }));

    ws.on('message', message => {
        const data = JSON.parse(message);
        switch (data.type) {
            case 'start':
                discordToken = data.discordToken;
                voiceChannelId = data.voiceChannelId;
                startBot();
                break;
            case 'stop':
                stopBot();
                break;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    log(`خادم الويب يعمل على المنفذ ${PORT}`);
});

if (discordToken && voiceChannelId) {
    startBot();
}
