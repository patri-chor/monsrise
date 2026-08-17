window.__ModuleLoader__.load({
	id: "dsh-terminal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/** 需要的服务：会话运行时（读取当前会话的工作目录）。 */
		const inject = ["sessions"];

		//#region xterm.js（UMD，内联构建）
		/*__XTERM_UMD__*/
		//#endregion
		//#region xterm-addon-fit（UMD，内联构建）
		/*__FIT_UMD__*/
		//#endregion

		// ── 样式 ────────────────────────────────────────────────────────────

		const XTERM_CSS = /*__XTERM_CSS__*/;

		const PANEL_CSS = `
.dsh-terminal-tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482900;writing-mode:vertical-rl;background:var(--dsw-specific-menu,#26292f);color:var(--dsw-alias-label-secondary,#a0a5ad);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));border-right:0;border-radius:10px 0 0 10px;padding:10px 5px;font-size:12px;letter-spacing:2px;cursor:pointer;user-select:none;box-shadow:-2px 0 8px rgba(0,0,0,.18)}
.dsh-terminal-tab:hover{color:var(--dsw-alias-label-primary,#e8eaed)}
.dsh-terminal-tabOpen{color:var(--dsw-alias-label-primary,#e8eaed)}
.dsh-terminal-panel{position:fixed;right:0;top:0;bottom:0;z-index:2147482900;width:min(560px,88vw);display:flex;flex-direction:column;background:var(--dsw-specific-menu,#26292f);border-left:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));box-shadow:-8px 0 24px rgba(0,0,0,.3);animation:dsh-terminal-in .18s ease-out;font-family:var(--dsw-font-sans,system-ui,sans-serif)}
@keyframes dsh-terminal-in{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}
.dsh-terminal-head{display:flex;align-items:center;gap:8px;height:38px;padding:0 10px 0 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));flex:none}
.dsh-terminal-title{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8eaed);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-terminal-close{flex:none;border:0;background:0 0;color:var(--dsw-alias-label-tertiary,#6d7278);font-size:16px;line-height:16px;padding:4px 6px;border-radius:6px;cursor:pointer}
.dsh-terminal-close:hover{color:var(--dsw-alias-label-primary,#e8eaed);background:var(--dsw-alias-fill-l2,rgba(128,128,128,.15))}
.dsh-terminal-body{flex:1;min-height:0;padding:6px 0 6px 6px;background:#0e1116;position:relative;overflow:hidden}
.dsh-terminal-body .xterm{height:100%}
.dsh-terminal-body .xterm-viewport{background:transparent!important}
.dsh-terminal-status{position:absolute;left:8px;bottom:6px;z-index:5;font-size:11px;color:var(--dsw-alias-label-tertiary,#6d7278);background:rgba(0,0,0,.55);border-radius:6px;padding:2px 8px;pointer-events:none;font-family:var(--dsw-font-mono,ui-monospace,monospace)}
`;

		let cssInjected = false;
		function ensureStyles() {
			if (cssInjected || typeof document === "undefined") return;
			cssInjected = true;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-terminal";
			tag.dataset.pluginCss = "dsh-terminal/styles";
			tag.textContent = XTERM_CSS + "\n" + PANEL_CSS;
			document.head.appendChild(tag);
		}

		// ── 终端面板（纯 DOM，xterm + WebSocket） ──────────────────────────

		const WS_PATH = "/api/dsh-terminal";
		let tabEl = null;
		let panelEl = null;
		let term = null;
		let fit = null;
		let socket = null;
		let disposed = false;

		function currentCwd(sessions) {
			try {
				const snap = sessions.list.getSnapshot();
				const id = snap && snap.current;
				if (typeof id === "string") {
					const row = snap.byId && snap.byId[id];
					if (row && typeof row.cwd === "string" && row.cwd !== "") return row.cwd;
				}
			} catch {}
			return "";
		}

		function wsUrl(sessions) {
			const proto = location.protocol === "https:" ? "wss:" : "ws:";
			const cwd = encodeURIComponent(currentCwd(sessions) || "");
			const cols = term ? term.cols : 80;
			const rows = term ? term.rows : 24;
			return `${proto}//${location.host}${WS_PATH}?cwd=${cwd}&cols=${cols}&rows=${rows}`;
		}

		function send(frame) {
			if (socket !== null && socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify(frame));
			}
		}

		function setStatus(text) {
			if (panelEl === null) return;
			let el = panelEl.querySelector(".dsh-terminal-status");
			if (el === null) {
				el = document.createElement("div");
				el.className = "dsh-terminal-status";
				panelEl.querySelector(".dsh-terminal-body")?.appendChild(el);
			}
			el.textContent = text;
		}

		function openTerminal(sessions) {
			if (disposed) return;
			const Terminal = window.Terminal;
			const FitAddon = window.FitAddon;
			if (typeof Terminal !== "function" || typeof FitAddon !== "function") {
				setStatus("xterm 加载失败");
				return;
			}
			term = new Terminal({
				fontFamily: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
				fontSize: 13,
				cursorBlink: true,
				theme: {
					background: "#0e1116",
					foreground: "#d7dae0"
				}
			});
			fit = new FitAddon.FitAddon();
			term.loadAddon(fit);
			const body = panelEl.querySelector(".dsh-terminal-body");
			term.open(body);
			try {
				fit.fit();
			} catch {}
			setStatus("连接中…");

			socket = new WebSocket(wsUrl(sessions));
			socket.onopen = () => {
				setStatus("");
			};
			socket.onmessage = (event) => {
				if (term === null) return;
				let frame;
				try {
					frame = JSON.parse(String(event.data));
				} catch {
					return;
				}
				if (frame.type === "output") {
					term.write(frame.data);
				} else if (frame.type === "ready") {
					const cwd = typeof frame.cwd === "string" && frame.cwd !== "" ? frame.cwd : "";
					const head = panelEl.querySelector(".dsh-terminal-title");
					if (head !== null) head.textContent = `终端 — ${cwd}`;
				} else if (frame.type === "exit") {
					term.write(`\r\n\x1b[90m[进程已退出 code=${String(frame.code)}${frame.message ? "：" + frame.message : ""}]\x1b[0m\r\n`);
					setStatus("已断开（点开/关重连）");
				}
			};
			socket.onclose = () => {
				socket = null;
				if (term !== null) setStatus("已断开（点开/关重连）");
			};
			socket.onerror = () => {
				setStatus("连接错误");
			};
			term.onData((data) => {
				send({ type: "input", data });
			});
			term.onResize(({ cols, rows }) => {
				send({ type: "resize", cols, rows });
			});
			// 容器尺寸变化 → fit + 通知 resize
			const ro = new ResizeObserver(() => {
				if (term === null) return;
				try {
					fit.fit();
				} catch {}
			});
			ro.observe(body);
			term._dshRo = ro;
			term.focus();
		}

		function closeTerminal() {
			if (socket !== null) {
				try {
					socket.close();
				} catch {}
				socket = null;
			}
			if (term !== null) {
				try {
					term._dshRo?.disconnect();
				} catch {}
				term.dispose();
				term = null;
				fit = null;
			}
		}

		function buildUi(sessions) {
			if (tabEl !== null || typeof document === "undefined") return;
			ensureStyles();
			tabEl = document.createElement("div");
			tabEl.className = "dsh-terminal-tab";
			tabEl.textContent = "终端";
			tabEl.title = "打开/关闭本地终端";
			document.body.appendChild(tabEl);

			panelEl = document.createElement("div");
			panelEl.className = "dsh-terminal-panel";
			panelEl.style.display = "none";
			panelEl.innerHTML =
				`<div class="dsh-terminal-head">` +
				`<span class="dsh-terminal-title">终端</span>` +
				`<button type="button" class="dsh-terminal-close" aria-label="关闭终端">×</button>` +
				`</div>` +
				`<div class="dsh-terminal-body"></div>`;
			document.body.appendChild(panelEl);

			tabEl.addEventListener("click", () => {
				const open = panelEl.style.display !== "none";
				if (open) {
					panelEl.style.display = "none";
					tabEl.classList.remove("dsh-terminal-tabOpen");
					closeTerminal();
				} else {
					panelEl.style.display = "flex";
					tabEl.classList.add("dsh-terminal-tabOpen");
					openTerminal(sessions);
				}
			});
			panelEl.querySelector(".dsh-terminal-close").addEventListener("click", () => {
				panelEl.style.display = "none";
				tabEl.classList.remove("dsh-terminal-tabOpen");
				closeTerminal();
			});
		}

		/** 插件主体。 */
		function apply(ctx) {
			const sessions = ctx.sessions;
			buildUi(sessions);
			ctx.effect(() => () => {
				disposed = true;
				closeTerminal();
				tabEl?.remove();
				panelEl?.remove();
				tabEl = null;
				panelEl = null;
			}, "dsh-terminal: ui cleanup");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
