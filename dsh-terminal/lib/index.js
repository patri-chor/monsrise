import { WebSocket, WebSocketServer } from "ws";
import pty from "node-pty";

/**
 * dsh-terminal — host half.
 *
 * 在 dsh web server 上注册 /api/dsh-terminal WebSocket 升级路由：
 * 每个连接用 node-pty（Windows ConPTY）拉起一个本地 cmd.exe（cwd 取浏览器传入的工作区路径），
 * 双向管道：PTY 输出 → WS 帧；WS 帧（input/resize）→ PTY。
 * 仅允许本机回环请求（与 dsh-ssh 相同的信任栅栏），避免局域网暴露执行本地 shell。
 */

const TERMINAL_PATH = "/api/dsh-terminal";

/** 当 WS 发送缓冲超过该值时暂停 PTY 读取，避免内存膨胀。 */
const BACKPRESSURE_HIGH_WATER = 1024 * 1024;
/** 低于该值时恢复。 */
const BACKPRESSURE_LOW_WATER = 512 * 1024;

/** 回环检查：源地址 + Host 头 + 同源标记（镜像 dsh-ssh 的栅栏）。 */
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}

const terminalWss = new WebSocketServer({ noServer: true });

/** 拒绝一个升级请求（写 HTTP 错误后销毁 socket）。 */
function rejectUpgrade(socket, status, reason) {
	socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
	socket.destroy();
}

/** 需要的服务：web 服务器（注册路由与升级处理）。 */
const inject = ["webServer"];

/**
 * 插件主体。
 * @param ctx - 宿主插件上下文（含 webServer）。
 */
function apply(ctx) {
	ctx.effect(() => ctx.webServer.registerUpgrade({
		path: TERMINAL_PATH,
		handler: (req, socket, head) => {
			if (!isLoopbackRequest(req)) {
				rejectUpgrade(socket, 403, "Forbidden");
				return;
			}
			const url = new URL(req.url ?? "/", "http://localhost");
			const cwd = url.searchParams.get("cwd") ?? "";
			const cols = Number.parseInt(url.searchParams.get("cols") ?? "80", 10);
			const rows = Number.parseInt(url.searchParams.get("rows") ?? "24", 10);
			terminalWss.handleUpgrade(req, socket, head, (ws) => {
				let child = null;
				let closed = false;
				let paused = false;

				const resume = () => {
					if (paused && ws.bufferedAmount < BACKPRESSURE_LOW_WATER) {
						paused = false;
						try {
							child?.resume();
						} catch {}
					}
				};
				const sendFrame = (frame) => {
					if (closed || ws.readyState !== WebSocket.OPEN) return;
					ws.send(JSON.stringify(frame), resume);
					if (!paused && ws.bufferedAmount > BACKPRESSURE_HIGH_WATER) {
						paused = true;
						try {
							child?.pause();
						} catch {}
					}
				};
				const closeAll = () => {
					if (closed) return;
					closed = true;
					try {
						child?.kill();
					} catch {}
					child = null;
					try {
						ws.close();
					} catch {}
				};

				try {
					child = pty.spawn(process.env.ComSpec || "cmd.exe", [], {
						name: "xterm-256color",
						cols: Number.isFinite(cols) && cols > 0 ? cols : 80,
						rows: Number.isFinite(rows) && rows > 0 ? rows : 24,
						cwd: cwd !== "" && typeof cwd === "string" ? cwd : process.cwd(),
						env: {
							...process.env,
							TERM: "xterm-256color",
							COLORTERM: "truecolor"
						}
					});
				} catch (error) {
					sendFrame({
						type: "exit",
						code: -1,
						message: error instanceof Error ? error.message : String(error)
					});
					closeAll();
					return;
				}

				child.onData((data) => {
					sendFrame({ type: "output", data });
				});
				child.onExit(({ exitCode }) => {
					sendFrame({ type: "exit", code: exitCode ?? 0 });
					closeAll();
				});
				ws.on("message", (raw) => {
					if (child === null || closed) return;
					let frame;
					try {
						frame = JSON.parse(String(raw));
					} catch {
						return;
					}
					if (frame === null || typeof frame !== "object") return;
					if (frame.type === "input" && typeof frame.data === "string") {
						try {
							child.write(frame.data);
						} catch {}
					} else if (frame.type === "resize") {
						const c = Number(frame.cols);
						const r = Number(frame.rows);
						if (Number.isFinite(c) && Number.isFinite(r) && c > 0 && r > 0) {
							try {
								child.resize(c, r);
							} catch {}
						}
					}
				});
				ws.on("close", closeAll);
				ws.on("error", closeAll);

				sendFrame({
					type: "ready",
					cwd: child ? (cwd !== "" ? cwd : process.cwd()) : ""
				});
			});
		}
	}), "dsh-terminal: websocket upgrade route");
}

export { apply, inject };
