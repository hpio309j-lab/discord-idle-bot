const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
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
        logs.shift(); // Keep logs array from growing too large
    }
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'log', message: logEntry }));
        }
    });
}

async function startBot() {
    if (botRunning) {
        log('البوت يعمل بالفعل.');
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
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates
        ]
    });

    discordClient.on('ready', async () => {
        log(`تم تسجيل الدخول كـ ${discordClient.user.tag}!`);
        botRunning = true;
        await joinVoiceChannel(voiceChannelId);
    });

    discordClient.on('voiceStateUpdate', (oldState, newState) => {
        // Check if the bot was kicked or disconnected from the channel
        if (newState.id === discordClient.user.id && oldState.channelId === voiceChannelId && newState.channelId === null) {
            log('تم فصل البوت من الغرفة الصوتية. محاولة إعادة الاتصال بعد 10 ثوانٍ...');
            setTimeout(() => joinVoiceChannel(voiceChannelId), 10000);
        }
    });

    discordClient.on('error', (error) => {
        log(`خطأ في عميل Discord: ${error.message}`);
        stopBot();
    });

    try {
        await discordClient.login(discordToken);
        log('تم بدء البوت بنجاح.');
    } catch (error) {
        log(`فشل تسجيل الدخول إلى Discord: ${error.message}`);
        botRunning = false;
    }
}

async function joinVoiceChannel(channelId) {
    if (!discordClient || !discordClient.isReady()) {
        log('عميل Discord غير جاهز للاتصال.');
        return;
    }

    const guild = discordClient.guilds.cache.first();
    if (!guild) {
        log('لم يتم العثور على خادم (Guild). تأكد من أن البوت في خادم واحد على الأقل.');
        return;
    }

    const channel = guild.channels.cache.get(channelId);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
        log(`خطأ: الغرفة الصوتية بالمعرف ${channelId} غير موجودة أو ليست غرفة صوتية.`);
        return;
    }

    try {
        const connection = await channel.join();
        connection.voice.setSelfMute(true); // Mute the bot
        log(`تم الانضمام إلى الغرفة الصوتية: ${channel.name}`);
    } catch (error) {
        log(`فشل الانضمام إلى الغرفة الصوتية: ${error.message}`);
        log('محاولة إعادة الاتصال بعد 10 ثوانٍ...');
        setTimeout(() => joinVoiceChannel(channelId), 10000);
    }
}

function stopBot() {
    if (!botRunning) {
        log('البوت متوقف بالفعل.');
        return;
    }

    if (discordClient) {
        discordClient.destroy();
        discordClient = null;
    }
    botRunning = false;
    log('تم إيقاف البوت.');
}

// Web Dashboard
app.use(express.static('public')); // Serve static files (HTML, CSS, JS) from a 'public' directory

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

wss.on('connection', ws => {
    log('تم اتصال عميل جديد بلوحة التحكم.');
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
            case 'set_credentials':
                discordToken = data.discordToken;
                voiceChannelId = data.voiceChannelId;
                log('تم تحديث بيانات الاعتماد.');
                break;
        }
    });

    ws.on('close', () => {
        log('تم قطع اتصال عميل لوحة التحكم.');
    });

    ws.on('error', error => {
        log(`خطأ في اتصال WebSocket: ${error.message}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    log(`خادم الويب يعمل على المنفذ ${PORT}`);
    log('للوصول إلى لوحة التحكم، افتح متصفحك على http://localhost:' + PORT);
    log('إذا كنت تستخدم Railway، فسيتم توفير عنوان URL عام.');
});

// Initial start if environment variables are set
if (discordToken && voiceChannelId) {
    startBot();
}
