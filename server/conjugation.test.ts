import { describe, expect, it } from "vitest";
import { conjugate } from "./conjugation";

describe("conjugation engine", () => {
  describe("Godan verbs (五段动词)", () => {
    it("conjugates 飲む correctly", () => {
      const result = conjugate("飲む", "GODAN");
      expect(result.dictionaryForm).toBe("飲む");
      expect(result.negative).toBe("飲まない");
      expect(result.polite).toBe("飲みます");
      expect(result.teForm).toBe("飲んで");
      expect(result.taForm).toBe("飲んだ");
      expect(result.potential).toBe("飲める");
      expect(result.passive).toBe("飲まれる");
      expect(result.causative).toBe("飲ませる");
      expect(result.imperative).toBe("飲め");
      expect(result.volitional).toBe("飲もう");
    });

    it("conjugates 書く correctly", () => {
      const result = conjugate("書く", "GODAN");
      expect(result.negative).toBe("書かない");
      expect(result.polite).toBe("書きます");
      expect(result.teForm).toBe("書いて");
      expect(result.taForm).toBe("書いた");
    });

    it("handles special case 行く", () => {
      const result = conjugate("行く", "GODAN");
      expect(result.teForm).toBe("行って");
      expect(result.taForm).toBe("行った");
    });

    it("conjugates 話す correctly", () => {
      const result = conjugate("話す", "GODAN");
      expect(result.teForm).toBe("話して");
      expect(result.taForm).toBe("話した");
    });
  });

  describe("Ichidan verbs (一段动词)", () => {
    it("conjugates 食べる correctly", () => {
      const result = conjugate("食べる", "ICHIDAN");
      expect(result.dictionaryForm).toBe("食べる");
      expect(result.negative).toBe("食べない");
      expect(result.polite).toBe("食べます");
      expect(result.teForm).toBe("食べて");
      expect(result.taForm).toBe("食べた");
      expect(result.potential).toBe("食べられる");
      expect(result.passive).toBe("食べられる");
      expect(result.causative).toBe("食べさせる");
      expect(result.imperative).toBe("食べろ");
      expect(result.volitional).toBe("食べよう");
    });

    it("conjugates 見る correctly", () => {
      const result = conjugate("見る", "ICHIDAN");
      expect(result.negative).toBe("見ない");
      expect(result.polite).toBe("見ます");
    });
  });

  describe("Suru verbs (サ变动词)", () => {
    it("conjugates 勉強する correctly", () => {
      const result = conjugate("勉強する", "SURU");
      expect(result.dictionaryForm).toBe("勉強する");
      expect(result.negative).toBe("勉強しない");
      expect(result.polite).toBe("勉強します");
      expect(result.teForm).toBe("勉強して");
      expect(result.taForm).toBe("勉強した");
      expect(result.potential).toBe("勉強できる");
      expect(result.passive).toBe("勉強される");
      expect(result.causative).toBe("勉強させる");
      expect(result.imperative).toBe("勉強しろ");
      expect(result.volitional).toBe("勉強しよう");
    });
  });

  describe("Kuru verbs (カ变动词)", () => {
    it("conjugates 来る correctly", () => {
      const result = conjugate("来る", "KURU");
      expect(result.dictionaryForm).toBe("来る");
      expect(result.negative).toBe("こない");
      expect(result.polite).toBe("きます");
      expect(result.teForm).toBe("きて");
      expect(result.taForm).toBe("きた");
      expect(result.potential).toBe("こられる");
      expect(result.passive).toBe("こられる");
      expect(result.causative).toBe("こさせる");
      expect(result.imperative).toBe("こい");
      expect(result.volitional).toBe("こよう");
    });
  });
});
