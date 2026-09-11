const { sleep } = global; // atau require('./function') jika perlu

let sock = null;
let timeoutId = null;

function setSocket(s) {
    sock = s;
}

function stop() {
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
}

function start() {
    stop(); // hentikan jadwal lama

    const config = global.db?.settings?.autoJpm;
    // Jika tidak ada konfigurasi atau tidak aktif, berhenti
    if (!config || !config.enabled || !config.message || !config.interval) {
        return;
    }
    scheduleNext(config.interval);
}

async function scheduleNext(intervalMs) {
    if (!sock || !global.db?.settings?.autoJpm?.enabled) return;

    timeoutId = setTimeout(async () => {
        try {
            await sendAutoJpm();
        } catch (e) {
            console.error('❌ Auto JPM error:', e);
        }
        // Jadwalkan ulang
        scheduleNext(intervalMs);
    }, intervalMs);
}

async function sendAutoJpm() {
    if (!sock) return;
    const groups = await sock.groupFetchAllParticipating();
    const groupIds = Object.keys(groups);
    const blacklist = global.db.settings.bljpm || [];
    const message = global.db.settings.autoJpm?.message;
    if (!message) return;

    console.log(`🚀 Mengirim Auto JPM ke ${groupIds.length} grup...`);

    for (const id of groupIds) {
        if (blacklist.includes(id)) continue;

        try {
            if (message.media) {
                // Kirim media dengan caption
                const content = { caption: message.text || '' };
                if (message.media.type === 'image') {
                    content.image = { url: message.media.url };
                } else if (message.media.type === 'video') {
                    content.video = { url: message.media.url };
                }
                await sock.sendMessage(id, content);
            } else {
                await sock.sendMessage(id, { text: message.text });
            }

            // Jeda antar grup
            await sleep(global.jedaJpm || 2000);
        } catch (e) {
            console.error(`❌ Gagal kirim ke ${id}:`, e);
        }
    }
}

module.exports = { setSocket, start, stop };