declare module 'kuromoji' {
  interface Token {
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    pos_detail_2: string;
    pos_detail_3: string;
    conjugated_type: string;
    conjugated_form: string;
    basic_form: string;
    reading: string;
    pronunciation: string;
  }

  interface Tokenizer {
    tokenize(text: string): Token[];
  }

  interface TokenizerBuilder {
    build(callback: (err: Error | null, tokenizer: Tokenizer) => void): void;
  }

  export function builder(options: { dicPath: string }): TokenizerBuilder;
}

declare module 'sqlite-vec' {
  import type { Database } from 'better-sqlite3';
  export function load(db: Database): void;
}

declare module 'wanakana' {
  export function toKana(input: string): string;
  export function toRomaji(input: string): string;
  export function toHiragana(input: string): string;
  export function toKatakana(input: string): string;
  export function isKana(input: string): boolean;
  export function isKanji(input: string): boolean;
  export function isHiragana(input: string): boolean;
  export function isKatakana(input: string): boolean;
  export function isJapanese(input: string): boolean;
  export function isMixed(input: string): boolean;
  export function isRomaji(input: string): boolean;
  export function stripOkurigana(input: string): string;
  export function tokenize(input: string): string[];
}

declare module 'ollama' {
  export interface ChatMessage {
    role: string;
    content: string;
  }

  export interface ChatOptions {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
    options?: Record<string, unknown>;
  }

  export interface ChatResponse {
    message: ChatMessage;
    done: boolean;
  }

  export class Ollama {
    constructor(options?: { host?: string });
    chat(options: ChatOptions): Promise<ChatResponse>;
    chat(options: ChatOptions & { stream: true }): AsyncIterable<ChatResponse>;
    list(): Promise<{ models: Array<{ name: string }> }>;
  }
}


