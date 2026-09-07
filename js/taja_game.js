'use strict';

const TajaGame = {
    fullSentence: '',
    nextSentence: '',
    currentPos: 0,
    startTime: null,
    errorCount: 0,
    isCountdown: false,
    isComposing: false,
    countdownTimer: null,

    get serverUrl() {
        return typeof OKTAJA_SERVER_URL !== 'undefined'
            ? OKTAJA_SERVER_URL
            : 'https://ai.okko.kr/taja_admin';
    },

    init() {
        const input = document.getElementById('taja_input');
        const target = document.getElementById('target_word');
        if (!input || !target) return;

        input.disabled = true;
        target.textContent = '서버에서 문장을 불러오는 중...';

        this.fetchSentence();

        input.addEventListener('compositionstart', () => {
            this.isComposing = true;
        });

        input.addEventListener('compositionend', () => {
            this.isComposing = false;
            this.checkTaja();
        });

        input.addEventListener('input', () => {
            if (!this.isComposing) this.checkTaja();
        });
    },

    async fetchSentence() {
        try {
            const response = await fetch(`${this.serverUrl}/get_sentence.php?room=${encodeURIComponent(ROOM_ID)}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            if (!data?.sentence) throw new Error('문장 데이터 없음');

            this.fullSentence = data.sentence.trim();
            this.resetRound(true);
        } catch (error) {
            console.error('문장 로드 실패:', error);
            const target = document.getElementById('target_word');
            if (target) target.textContent = '문장 로드 실패!';
        }
    },

    renderSentence() {
        const target = document.getElementById('target_word');
        if (!target || !this.fullSentence) return;

        const done = this.fullSentence.substring(0, this.currentPos);
        const current = this.fullSentence.charAt(this.currentPos);
        const remaining = this.fullSentence.substring(this.currentPos + 1);

        target.replaceChildren();

        const doneSpan = document.createElement('span');
        doneSpan.className = 'hl-done';
        doneSpan.textContent = done;
        target.appendChild(doneSpan);

        if (current) {
            const currentSpan = document.createElement('span');
            currentSpan.className = 'hl-cur';
            currentSpan.textContent = current;
            target.appendChild(currentSpan);
        }

        target.append(document.createTextNode(remaining));
    },

    checkTaja() {
        if (this.currentPos === this.fullSentence.length && this.currentPos > 0) return;

        const input = document.getElementById('taja_input');
        if (!input || input.disabled) return;

        if (!this.startTime) this.startTime = Date.now();

        const typed = input.value;
        const expected = this.fullSentence.substring(0, typed.length);

        if (typed === expected) {
            input.classList.remove('error');
            this.currentPos = typed.length;

            const progress = this.fullSentence.length
                ? (this.currentPos / this.fullSentence.length) * 100
                : 0;

            this.setText('current_progress', Math.round(progress));
            TajaRender.updatePlayer(USER_INFO.id, USER_INFO.nick, Math.round(progress));

            if (this.currentPos % 3 === 0 && TajaCore.isConnected) {
                TajaCore.sendProgressNow(progress, false);
            }

            this.renderSentence();
            this.updateStats();

            if (this.currentPos === this.fullSentence.length && this.currentPos > 0) {
                this.finish();
            }

            return;
        }

        const previousExpected = this.fullSentence.substring(0, typed.length - 1);
        if (typed.slice(0, -1) === previousExpected) {
            input.classList.add('error');
            setTimeout(() => input.classList.remove('error'), 300);
            this.errorCount += 1;
            this.updateStats();
        }
    },

    updateStats() {
        if (!this.startTime) return;

        const elapsedSeconds = Math.max((Date.now() - this.startTime) / 1000, 0.001);
        const typedText = this.fullSentence.substring(0, this.currentPos);
        let strokes = 0;

        for (let i = 0; i < typedText.length; i += 1) {
            const code = typedText.charCodeAt(i);

            if (code >= 0xAC00 && code <= 0xD7A3) {
                strokes += (code - 0xAC00) % 28 > 0 ? 3 : 2;
            } else {
                strokes += 1;
            }
        }

        const typingSpeed = Math.max(0, Math.floor((strokes / elapsedSeconds) * 60));
        const accuracy = this.currentPos > 0
            ? Math.max(0, Math.floor(((this.currentPos - this.errorCount) / this.currentPos) * 100))
            : 100;

        this.setText('current_wpm', Number.isFinite(typingSpeed) ? typingSpeed : 0);
        this.setText('current_acc', accuracy);
    },

    async finish() {
        const input = document.getElementById('taja_input');
        if (input) input.disabled = true;

        const score = Number(document.getElementById('current_wpm')?.textContent || 0);
        const accuracy = Number(document.getElementById('current_acc')?.textContent || 0);

        TajaRender.updatePlayer(USER_INFO.id, USER_INFO.nick, 100, score);
        TajaCore.sendProgressNow(100, true);

        await this.saveRank(score, accuracy);
        await this.requestNextRound(score);
    },

    async saveRank(score, accuracy) {
        if (typeof RANK_SAVE_URL === 'undefined' || !RANK_SAVE_URL) return;

        const body = new URLSearchParams({
            score: String(score),
            acc: String(accuracy)
        });

        let message = `🏁 완주! ${score}타 / 정확도 ${accuracy}%`;

        try {
            const response = await fetch(RANK_SAVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: body.toString()
            });

            const text = await response.text();
            try {
                const data = JSON.parse(text);
                if (data?.msg) message = data.msg;
            } catch (_) {
                // 서버 응답이 JSON이 아니어도 기본 완주 메시지를 사용한다.
            }
        } catch (error) {
            console.warn('랭킹 저장 실패:', error);
        }

        TajaRender.addChatMsg('SYSTEM', TajaRender.escapeHtml(message), false, true);
    },

    async requestNextRound(score) {
        try {
            const response = await fetch(`${this.serverUrl}/get_sentence.php?room=${encodeURIComponent(ROOM_ID)}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            if (data?.sentence) {
                TajaCore.sendNewRoundInfo(data.sentence.trim(), USER_INFO.nick, score);
            }
        } catch (error) {
            console.warn('다음 문장 요청 실패:', error);
        }
    },

    startNextRoundCountdown(sentence, winnerNick, winnerWpm) {
        if (this.isCountdown || !sentence) return;

        const overlay = document.getElementById('countdown-overlay');
        if (!overlay) return;

        this.isCountdown = true;
        this.nextSentence = sentence;

        overlay.replaceChildren();

        if (winnerNick) {
            const winner = document.createElement('div');
            winner.className = 'countdown-winner';
            winner.innerHTML = `🏆 1위: ${TajaRender.parseNickHtml(winnerNick)} (${Number(winnerWpm) || 0}타)`;
            overlay.appendChild(winner);
        }

        const row = document.createElement('div');
        row.className = 'countdown-row';
        row.innerHTML = `
            <div id="cd-num" class="cd-num">10</div>
            <div class="cd-label countdown-label">라스트 스퍼트!<br>잠시 후 다음 라운드가 시작됩니다.</div>
        `;
        overlay.appendChild(row);
        overlay.classList.add('show');

        let seconds = 10;
        clearInterval(this.countdownTimer);

        this.countdownTimer = setInterval(() => {
            seconds -= 1;
            this.setText('cd-num', seconds);

            if (seconds <= 0) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
                overlay.classList.remove('show');
                this.isCountdown = false;
                this.fullSentence = this.nextSentence;
                this.resetRound(false);
            }
        }, 1000);
    },

    async resetRound(isInitial = false) {
        this.currentPos = 0;
        this.startTime = null;
        this.errorCount = 0;

        this.setText('current_wpm', 0);
        this.setText('current_acc', 100);
        this.setText('current_progress', 0);

        if (!isInitial) {
            const round = document.getElementById('current_round');
            if (round) round.textContent = String(Number(round.textContent || 0) + 1);
        }

        await this.notifyRoundStart();

        const input = document.getElementById('taja_input');
        if (!input) return;

        input.disabled = false;
        input.value = '';

        TajaRender.resetAllPlayers();
        this.renderSentence();
        input.focus();
    },

    async notifyRoundStart() {
        if (typeof RANK_START_URL === 'undefined' || !RANK_START_URL) return;

        try {
            await fetch(RANK_START_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
            });
        } catch (error) {
            console.warn('라운드 시작 기록 실패:', error);
        }
    },

    setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    }
};
