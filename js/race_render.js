'use strict';

const TajaRender = {
    players: [],
    avatars: ['🧑', '👩', '🧔', '👱', '🙋', '🧑‍💻'],
    lastSendTime: 0,

    init() {
        this.players = [{
            id: USER_INFO.id,
            nick: USER_INFO.nick,
            progress: 0,
            wpm: 0,
            me: true,
            lastSeen: Date.now()
        }];

        this.buildUI();
        this.initChatEvents();
    },

    escapeHtml(value) {
        if (!value) return '';

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    parseNickHtml(nick) {
        if (!nick) return '레이서';

        const safeNick = this.escapeHtml(nick);
        const atIndex = safeNick.indexOf('@');

        if (atIndex < 0) return safeNick;

        const name = safeNick.slice(0, atIndex);
        const domain = safeNick.slice(atIndex + 1);

        return `${name} <span class="domain-tag">@${domain}</span>`;
    },

    findPlayer(userId) {
        return this.players.find(player => String(player.id) === String(userId));
    },

    updatePlayer(userId, nick, progress = 0, wpm) {
        let player = this.findPlayer(userId);

        if (!player) {
            player = {
                id: userId,
                nick: nick || '레이서',
                progress: 0,
                wpm: 0,
                me: String(userId) === String(USER_INFO.id),
                lastSeen: Date.now()
            };
            this.players.push(player);
        }

        if (nick) player.nick = nick;
        player.progress = Number(progress) || 0;
        player.lastSeen = Date.now();

        if (wpm !== undefined) {
            player.wpm = Number(wpm) || 0;
        }

        this.buildUI();
    },

    removePlayer(userId) {
        const targetId = String(userId).trim().toLowerCase();
        const beforeCount = this.players.length;

        this.players = this.players.filter(player => {
            return String(player.id).trim().toLowerCase() !== targetId;
        });

        if (beforeCount !== this.players.length) {
            console.log(`✅ 레이서 제거 완료: ${targetId}`);
        }

        this.buildUI();
    },

    resetAllPlayers() {
        this.players.forEach(player => {
            player.progress = 0;
            player.wpm = 0;
        });

        this.buildUI();
    },

    renderAllPlayers() {
        this.buildUI();
    },

    buildUI() {
        const rankList = document.getElementById('rank-list');
        const raceArea = document.getElementById('race-area');

        if (!rankList || !raceArea) return;

        rankList.replaceChildren();
        raceArea.replaceChildren();

        const sortedPlayers = [...this.players].sort((a, b) => b.progress - a.progress);

        sortedPlayers.forEach((player, index) => {
            const medalClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
            const rankText = index === 0 ? '①' : index === 1 ? '②' : index === 2 ? '③' : String(index + 1);
            const nickHtml = this.parseNickHtml(player.nick);
            const avatar = this.avatars[index % this.avatars.length];
            const progress = Math.max(0, Math.min(100, Number(player.progress) || 0));

            const rankItem = document.createElement('div');
            rankItem.className = `rank-item${player.me ? ' me' : ''}`;
            rankItem.innerHTML = `
                <div class="rank-num ${medalClass}">${rankText}</div>
                <div class="rank-avatar">${avatar}</div>
                <div class="rank-info">
                    <div class="rank-nick">${nickHtml}</div>
                    <div class="rank-wpm">${Number(player.wpm) || 0} 타</div>
                </div>
                <div class="rank-progress-wrap">
                    <div class="rank-bar-bg">
                        <div class="rank-bar-fill" style="width:${progress}%"></div>
                    </div>
                </div>
            `;
            rankList.appendChild(rankItem);

            const racePlayer = document.createElement('div');
            racePlayer.className = `race-player${player.me ? ' me' : ''}`;
            racePlayer.innerHTML = `
                <div class="player-nick">
                    ${nickHtml}${player.me ? '<span class="me-badge">나</span>' : ''}
                </div>
                <div class="race-track">
                    <div class="race-fill" style="width:${progress}%"></div>
                </div>
                <div class="player-pct">${Math.round(progress)}%</div>
            `;
            raceArea.appendChild(racePlayer);
        });
    },

    addChatMsg(nick, message, isMine = false, isSystem = false) {
        const container = document.getElementById('chat-messages');
        if (!container) return;

        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const item = document.createElement('div');
        item.className = `chat-msg${isMine ? ' me' : ''}${isSystem ? ' system' : ''}`;

        if (isSystem) {
            item.innerHTML = `<div class="msg-text">${message}</div>`;
        } else {
            item.innerHTML = `
                <div class="msg-nick">${this.parseNickHtml(nick)}</div>
                <div class="msg-text">${this.escapeHtml(message)}</div>
                <div class="msg-time">${time}</div>
            `;
        }

        container.appendChild(item);
        container.scrollTop = container.scrollHeight;
    },

    checkSpam() {
        const now = Date.now();

        if (now - this.lastSendTime < 1000) {
            alert('메시지를 너무 빨리 보낼 수 없습니다.');
            return false;
        }

        this.lastSendTime = now;
        return true;
    },

    sendEmoji(emoji) {
        if (!this.checkSpam()) return;

        TajaCore.sendChat(emoji);
        this.addChatMsg(USER_INFO.nick, emoji, true, false);
    },

    sendChatFromInput() {
        const input = document.getElementById('chat_input');
        if (!input) return;

        const message = input.value.trim();
        if (!message || !this.checkSpam()) return;

        this.addChatMsg(USER_INFO.nick, message, true, false);
        TajaCore.sendChat(message);

        input.value = '';
        input.focus();
    },

    initChatEvents() {
        const input = document.getElementById('chat_input');
        const sendButton = document.getElementById('chat_send');

        if (!input || !sendButton) return;

        sendButton.addEventListener('click', () => this.sendChatFromInput());

        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.sendChatFromInput();
            }

            if (event.key === 'Escape') {
                document.getElementById('taja_input')?.focus();
            }
        });

        document.querySelectorAll('.emoji-btn[data-emoji]').forEach(button => {
            button.addEventListener('click', () => this.sendEmoji(button.dataset.emoji));
        });
    }
};
