/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
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
  export function isRomaji(input: string): boolean;
  export function stripOkurigana(input: string): string;
  export function tokenize(input: string): string[];
}
