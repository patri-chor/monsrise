window.__ModuleLoader__.load({
	id: "dsh-notify",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** 需要的服务：会话运行时（sessions.list 是列表快照 store）。 */
		const inject = ["sessions"];

		// ── 样式（右下角弹窗） ────────────────────────────────────────────────

		const CSS = `
.dsh-notify-host{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}
.dsh-notify-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;box-sizing:border-box;min-width:250px;max-width:min(360px,calc(100vw - 32px));padding:12px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));background:var(--dsw-specific-menu,#26292f);color:var(--dsw-alias-label-primary,#e8eaed);box-shadow:var(--dsw-shadow-lv3,0 8px 30px rgba(0,0,0,.35));font-family:var(--dsw-font-sans,system-ui,sans-serif);font-size:13px;line-height:20px;cursor:pointer;animation:dsh-notify-in .25s ease-out}
.dsh-notify-toast[data-kind=question]{border-color:var(--dsw-alias-state-business-primary,rgba(80,140,255,.55))}
.dsh-notify-toast[data-kind=complete]{border-color:var(--dsw-alias-state-success-primary,rgba(60,190,120,.55))}
.dsh-notify-icon{flex:none;font-size:16px;line-height:20px}
.dsh-notify-body{flex:1;min-width:0}
.dsh-notify-title{font-weight:600;color:var(--dsw-alias-label-primary,#e8eaed)}
.dsh-notify-desc{color:var(--dsw-alias-label-secondary,#a0a5ad);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-notify-close{flex:none;border:0;background:0 0;color:var(--dsw-alias-label-tertiary,#6d7278);font-size:16px;line-height:16px;padding:2px;margin:-2px -2px 0 0;border-radius:6px;cursor:pointer}
.dsh-notify-close:hover{color:var(--dsw-alias-label-primary,#e8eaed);background:var(--dsw-alias-fill-l2,rgba(128,128,128,.15))}
.dsh-notify-toast.dsh-notify-leave{opacity:0;transform:translateX(12px);transition:opacity .2s,transform .2s}
@keyframes dsh-notify-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
`;

		// ── 右下角弹窗引擎 ────────────────────────────────────────────────────

		const MAX_TOASTS = 4;
		let toastHost = null;

		function ensureStyles() {
			const cssId = "dsh-notify/styles";
			if (typeof document === "undefined" || document.querySelector(`style[data-plugin-css="${cssId}"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-notify";
			tag.dataset.pluginCss = cssId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		function hostEl() {
			if (toastHost !== null) return toastHost;
			toastHost = document.createElement("div");
			toastHost.className = "dsh-notify-host";
			document.body.appendChild(toastHost);
			return toastHost;
		}

		function removeToast(el) {
			if (el.parentNode === null) return;
			el.classList.add("dsh-notify-leave");
			setTimeout(() => {
				el.parentNode?.removeChild(el);
			}, 220);
		}

		/**
		 * 在右下角弹出一条通知；点击通知跳转到对应会话。
		 * @param kind - "question" | "complete"
		 * @param sessionId - 对应会话 id
		 * @param title - 会话显示标题
		 * @param open - 跳转会话的回调（点击时调用）
		 */
		function showToast(kind, sessionId, title, open) {
			ensureStyles();
			const host = hostEl();
			// 同一会话同一类型的通知只保留一条，避免重复弹窗
			const existing = host.querySelector(`.dsh-notify-toast[data-session="${CSS.escape(sessionId)}"][data-kind="${kind}"]`);
			if (existing !== null) return;
			const el = document.createElement("div");
			el.className = "dsh-notify-toast";
			el.dataset.kind = kind;
			el.dataset.session = sessionId;
			el.setAttribute("role", "status");
			const isQuestion = kind === "question";
			const titleText = isQuestion ? "模型向你提问了" : "任务已完成";
			const desc = title ? `「${title}」` : "点击查看详情";
			el.innerHTML = `<span class="dsh-notify-icon">${isQuestion ? "❓" : "✅"}</span>` +
				`<div class="dsh-notify-body"><div class="dsh-notify-title">${titleText}</div><div class="dsh-notify-desc">${desc}</div></div>` +
				`<button type="button" class="dsh-notify-close" aria-label="关闭">×</button>`;
			el.addEventListener("click", (event) => {
				if (event.target instanceof HTMLElement && event.target.classList.contains("dsh-notify-close")) return;
				removeToast(el);
				try {
					open();
				} catch {
					/* 会话可能已不存在，忽略 */
				}
			});
			el.querySelector(".dsh-notify-close").addEventListener("click", (event) => {
				event.stopPropagation();
				removeToast(el);
			});
			host.appendChild(el);
			// 自动消失：提问 10s（需要用户回应），完成 6s
			setTimeout(() => removeToast(el), isQuestion ? 1e4 : 6e3);
			// 数量上限：超出时直接移除最旧的（不播放退场动画）
			while (host.childElementCount > MAX_TOASTS) {
				const oldest = host.firstElementChild;
				if (oldest === null) break;
				host.removeChild(oldest);
			}
		}

		// ── 提示音引擎（Web Audio，无需音频文件） ──────────────────────────────

		let audioCtx = null;

		function getAudioContext() {
			if (typeof window === "undefined" || typeof window.AudioContext === "undefined" && typeof window.webkitAudioContext === "undefined") return null;
			if (audioCtx !== null) return audioCtx;
			const AC = window.AudioContext || window.webkitAudioContext;
			try {
				audioCtx = new AC();
			} catch {
				audioCtx = null;
			}
			return audioCtx;
		}

		function resumeAudio() {
			const ac = getAudioContext();
			if (ac !== null && ac.state === "suspended") {
				ac.resume().catch(() => {});
			}
		}

		/** 浏览器自动播放策略：首次用户手势时解锁 AudioContext。 */
		function armAutoplayUnlock() {
			const unlock = () => {
				resumeAudio();
				window.removeEventListener("pointerdown", unlock);
				window.removeEventListener("pointerup", unlock);
				window.removeEventListener("keydown", unlock);
			};
			window.addEventListener("pointerdown", unlock);
			window.addEventListener("pointerup", unlock);
			window.addEventListener("keydown", unlock);
		}

		/** 合成一个衰减音。 */
		function tone(ac, { start, duration, freq, gain, type }) {
			const osc = ac.createOscillator();
			const g = ac.createGain();
			osc.type = type ?? "sine";
			osc.frequency.value = freq;
			g.gain.setValueAtTime(0.0001, start);
			g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
			g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
			osc.connect(g);
			g.connect(ac.destination);
			osc.start(start);
			osc.stop(start + duration + 0.05);
		}

		/** 提问提示音：两段上行短音（E5 → A5），提醒用户需要回应。 */
		function playQuestionSound() {
			const ac = getAudioContext();
			if (ac === null) return;
			resumeAudio();
			const t = ac.currentTime + 0.02;
			tone(ac, { start: t, duration: 0.18, freq: 659.25, gain: 0.16 });
			tone(ac, { start: t + 0.17, duration: 0.32, freq: 880, gain: 0.16 });
		}

		/** 完成提示音：清脆的双音铃声（C6 → G6），表示任务结束。 */
		function playCompleteSound() {
			const ac = getAudioContext();
			if (ac === null) return;
			resumeAudio();
			const t = ac.currentTime + 0.02;
			tone(ac, { start: t, duration: 0.5, freq: 1046.5, gain: 0.14 });
			tone(ac, { start: t + 0.06, duration: 0.7, freq: 1567.98, gain: 0.08 });
		}

		/** 同类提示音节流，避免多个会话同时完成时连响。 */
		const lastPlayedAt = { question: 0, complete: 0 };
		const GAP_MS = 500;
		function playThrottled(kind) {
			const now = Date.now();
			if (now - lastPlayedAt[kind] < GAP_MS) return;
			lastPlayedAt[kind] = now;
			if (kind === "question") playQuestionSound();
			else playCompleteSound();
		}

		// ── 事件监听：会话列表快照 diff ────────────────────────────────────
		//
		// 数据源：ctx.sessions.list（SessionListState 快照 store）。
		// 每个 SessionSummary 包含：
		//   running            —— 会话是否正在运行（agent/status 的镜像）
		//   pendingInteraction —— "question" | "plan-review" | "approval" | undefined
		//   completed          —— 运行态“完成提醒”（非当前会话 running→idle 时置位）

		function apply(ctx) {
			ctx.effect(() => {
				const sessions = ctx.sessions;
				let disposed = false;
				/** 上一帧每个会话的观察状态，作为基线用于边沿检测。 */
				let prev = new Map();

				const notify = (kind, sessionId, title) => {
					if (disposed) return;
					playThrottled(kind);
					showToast(kind, sessionId, title, () => sessions.open(sessionId));
				};

				const onListChange = () => {
					if (disposed) return;
					const snap = sessions.list.getSnapshot();
					const byId = snap && snap.byId ? snap.byId : {};
					const current = snap && snap.current;
					const next = new Map();
					for (const id of Object.keys(byId)) {
						const s = byId[id];
						if (!s || typeof s !== "object") continue;
						next.set(id, {
							running: s.running === true,
							pending: s.pendingInteraction,
							completed: s.completed === true,
							title: s.displayTitle
						});
					}
					for (const [id, cur] of next) {
						const before = prev.get(id);
						if (before === void 0) continue; // 首帧只建立基线，不播放
						// 模型提问 / 计划评审 → 提问通知
						if (before.pending !== "question" && before.pending !== "plan-review" && (cur.pending === "question" || cur.pending === "plan-review")) {
							notify("question", id, cur.title);
						}
						// 完成任务 → 完成通知
						// 1) 运行时的完成提醒（非当前会话完成）
						if (!before.completed && cur.completed) {
							notify("complete", id, cur.title);
						} else if (id === current && before.running && !cur.running && !cur.pending) {
							// 2) 当前会话从运行变为空闲（最终回答/任务结束）
							notify("complete", id, cur.title);
						}
					}
					prev = next;
				};

				const unsubscribe = sessions.list.subscribe(onListChange);
				onListChange(); // 初始基线
				return () => {
					disposed = true;
					unsubscribe();
				};
			}, "dsh-notify: session list subscription");
			armAutoplayUnlock();
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
