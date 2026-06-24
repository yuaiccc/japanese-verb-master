/**
 * 共享 tokenizer 状态模块。
 *
 * Kuromoji tokenizer 在 server.js 启动时异步构建，构建完成后通过
 * setTokenizer 注入。helpers.js / tools.js / server.js 均通过
 * getTokenizer() 读取，避免循环依赖。
 */

let tokenizer: any = null;

export function setTokenizer(t: any): void {
  tokenizer = t;
}

export function getTokenizer(): any {
  return tokenizer;
}

export function isTokenizerReady(): boolean {
  return !!tokenizer;
}
