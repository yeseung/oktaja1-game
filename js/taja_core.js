'use strict';

const TajaCore = {
    centrifuge: null,
    raceSubscription: null,
    noticeSubscription: null,
    isConnected: false,
    heartbeatTimer: null,

    get serverUrl() {
        return typeof OKTAJA_SERVER_URL !== 'undefined'
            ? OKTAJA_SERVER_URL
            : 'https://ai.okko.kr/taja_admin';
    },

    init() {
        if (typeof ROOM_ID === 'undefined') return;

        this.loadCentralSettings();
        this.connect();
    },

    async fetchJson(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    },

    async loadCentralSettings() {
        try {
            const data = await this.fetchJson(`${this.serverUrl}/get_status.php`, {
                credentials: 'include'
            });

            if (data.youtube_id) {
                this.renderYoutube(data.youtube_id, false, true);
            }

            this.renderFooter(data.channel_url, data.channel_name);
        } catch (error) {
            console.warn('중앙 서버 설정 로드 실패:', error);
        }
    },

    renderYoutube(videoId, autoplay = false, loop = false) {
        const wrap = document.getElementById('youtube-video-wrap');
        if (!wrap || !videoId) return;

        const safeId = encodeURIComponent(videoId);
        const params = new URLSearchParams({
            autoplay: autoplay ? '1' : '0',
            mute: '0'
        });

        if (loop) {
            params.set('loop', '1');
            params.set('playlist', videoId);
        }

        wrap.innerHTML = `
            <iframe
                id="yt-player"
                width="100%"
                height="130"
                src="https://www.youtube.com/embed/${safeId}?${params.toString()}"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen>
            </iframe>
        `;
    },

    renderFooter(channelUrl, channelName) {
        const footer = document.getElementById('taja-footer-wrap');
        if (!footer) return;

        const url = channelUrl || 'https://www.youtube.com/@1-nh2ur';
        const name = channelName || '1m suno music';

        footer.replaceChildren();

        const paragraph = document.createElement('p');
        paragraph.append('음악과 함께하는 옥타자 🎵 BGM 제공 및 저작권: ');

        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = name;

        paragraph.appendChild(link);
        paragraph.append(' (유튜브 퍼가기 정책 준수)');
        footer.appendChild(paragraph);
    },

    connect() {
        if (!this.centrifuge) {
            this.centrifuge = new Centrifuge('wss://ai.okko.kr/connection/websocket', {
                getToken: async () => {
                    const url = `${this.serverUrl}/auth_api.php?uid=${encodeURIComponent(USER_INFO.id)}`;
                    const data = await this.fetchJson(url);

                    if (data.status !== 'success' || !data.token) {
                        throw new Error('토큰 발급 실패');
                    }

                    return data.token;
                }
            });
        }

        this.createRaceSubscription();
        this.createNoticeSubscription();
        this.registerConnectionEvents();
        this.centrifuge.connect();
    },

    createRaceSubscription() {
        if (this.raceSubscription) return;

        const prefix = typeof CHANNEL_PREFIX !== 'undefined' ? CHANNEL_PREFIX : '';
        this.raceSubscription = this.centrifuge.newSubscription(`typing:${prefix}${ROOM_ID}`, {
            presence: true,
            join_leave: true
        });

        this.raceSubscription.on('publication', context => this.handleRacePublication(context.data));
        this.raceSubscription.on('joined', context => this.handlePlayerJoined(context.info));
        this.raceSubscription.on('left', context => this.handlePlayerLeft(context.info));
        this.raceSubscription.subscribe();
    },

    createNoticeSubscription() {
        if (this.noticeSubscription) return;

        const channel = typeof NOTICE_CHANNEL !== 'undefined' ? NOTICE_CHANNEL : 'taja_notice';
        this.noticeSubscription = this.centrifuge.newSubscription(channel);

        this.noticeSubscription.on('publication', context => this.handleNotice(context.data));
        this.noticeSubscription.on('subscribed', async () => {
            try {
                const history = await this.noticeSubscription.history({ limit: 1, reverse: true });
                const latest = history.publications?.[0];
                if (latest) this.handleNotice(latest.data);
            } catch (error) {
                console.warn('공지사항 히스토리 로드 실패:', error);
            }
        });

        this.noticeSubscription.subscribe();
    },

    registerConnectionEvents() {
        if (this._eventsRegistered) return;
        this._eventsRegistered = true;

        this.centrifuge.on('connected', () => {
            this.isConnected = true;
            document.getElementById('ws_status_dot')?.classList.add('connected');
            TajaRender.addChatMsg('', '🚀 서버와 연결되었습니다.', false, true);
            this.refreshPresence();
            this.startHeartbeat();
        });

        this.centrifuge.on('disconnected', () => {
            this.isConnected = false;
            document.getElementById('ws_status_dot')?.classList.remove('connected');
        });
    },

    handleRacePublication(data) {
        if (!data) return;

        if (data.action === 'NEWROUND') {
            TajaGame?.startNextRoundCountdown(data.sentence, data.winnerNick, data.winnerWpm);
            return;
        }

        if (data.userId && String(data.userId) !== String(USER_INFO.id)) {
            const player = TajaRender.findPlayer(data.userId);
            if (player) player.lastSeen = Date.now();
        }

        if (data.action === 'HEARTBEAT') return;

        if (data.action === 'CHAT') {
            if (String(data.userId) === String(USER_INFO.id)) return;
            TajaRender.addChatMsg(data.nick, data.msg, false, false);
            return;
        }

        if (String(data.userId) !== String(USER_INFO.id)) {
            TajaRender.updatePlayer(data.userId, data.nick, data.progress, data.wpm);
        }

        if (data.finished) {
            TajaRender.addChatMsg('', `🏁 ${TajaRender.parseNickHtml(data.nick)}님이 완주했습니다!`, false, true);
        }
    },

    handlePlayerJoined(info) {
        const userId = info?.user;
        if (!userId) return;

        console.log('👋 새 레이서 입장:', userId);
        TajaRender.updatePlayer(userId, '', 0, 0);

        if (this.isConnected) this.refreshPresence();
    },

    handlePlayerLeft(info) {
        const userId = info?.user;
        if (!userId) return;

        console.log('🚪 레이서 퇴장:', userId);
        TajaRender.removePlayer(userId);
    },

    startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

        this.heartbeatTimer = setInterval(() => {
            if (!this.isConnected || !this.raceSubscription) return;

            const now = Date.now();
            this.raceSubscription.publish({ action: 'HEARTBEAT', userId: USER_INFO.id });

            TajaRender.players.forEach(player => {
                if (String(player.id) === String(USER_INFO.id)) return;
                if (!player.lastSeen) player.lastSeen = now;

                if (now - player.lastSeen > 25000) {
                    TajaRender.removePlayer(player.id);
                }
            });
        }, 10000);
    },

    async refreshPresence() {
        if (!this.raceSubscription) return;

        try {
            const presence = await this.raceSubscription.presence();
            const activeUsers = Object.values(presence.clients || {})
                .map(client => client.user)
                .filter(Boolean);

            TajaRender.players = TajaRender.players.filter(player => {
                if (String(player.id) === String(USER_INFO.id)) return true;

                const normalizedId = String(player.id).replace(/[^a-z0-9]/gi, '_');
                return activeUsers.includes(player.id) || activeUsers.includes(normalizedId);
            });

            activeUsers.forEach(userId => {
                if (String(userId) === String(USER_INFO.id)) return;
                if (!TajaRender.findPlayer(userId)) {
                    TajaRender.updatePlayer(userId, '', 0, 0);
                }
            });

            TajaRender.renderAllPlayers();
        } catch (error) {
            console.error('Presence 조회 실패:', error);
        }
    },

    sendNewRoundInfo(sentence, winnerNick, winnerWpm) {
        if (!this.isConnected || !this.raceSubscription) return;

        this.raceSubscription.publish({
            action: 'NEWROUND',
            sentence,
            winnerNick,
            winnerWpm
        });
    },

    sendProgressNow(progress, finished = false) {
        if (!this.isConnected || !this.raceSubscription) return;

        this.raceSubscription.publish({
            action: 'GAME',
            userId: USER_INFO.id,
            nick: USER_INFO.nick,
            progress: Math.round(progress),
            finished
        });
    },

    sendChat(message) {
        if (!this.isConnected || !this.raceSubscription) return;

        this.raceSubscription.publish({
            action: 'CHAT',
            userId: USER_INFO.id,
            nick: USER_INFO.nick,
            msg: message
        });
    },

    handleNotice(data) {
        if (!data?.msg) return;

        if (data.type === 'YT') {
            this.renderYoutube(data.msg, true, false);
            return;
        }

        const notice = document.getElementById('notice_text');
        if (!notice) return;

        notice.replaceChildren();

        const isImage = /\.(jpeg|jpg|gif|png|webp)$/i.test(data.msg);
        let content;

        if (isImage) {
            content = document.createElement('img');
            content.src = data.msg;
            content.alt = '공지 이미지';
            content.className = 'notice-image';
        } else {
            content = document.createElement('span');
            content.textContent = data.msg;
            content.className = 'notice-message';
        }

        if (data.url) {
            const link = document.createElement('a');
            link.href = data.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'notice-link';
            link.appendChild(content);
            notice.appendChild(link);
        } else {
            notice.appendChild(content);
        }
    }
};
