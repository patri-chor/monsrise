/**
 * dsh-notify — node half.
 *
 * 纯客户端插件：空的 apply 让插件出现在宿主 Loader（cordis 行）中，
 * 浏览器端逻辑通过 exports["./client"]（见 dsh.client 声明）加载。
 * 所有提示音逻辑都在浏览器端（lib/client.js）执行。
 */
export function apply() {}
