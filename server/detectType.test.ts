import { describe, expect, it } from "vitest";
import { detectVerbType } from "./conjugation";

describe("detectVerbType", () => {
  describe("Godan verbs (五段动词)", () => {
    it("detects verbs ending with う段 characters", () => {
      expect(detectVerbType("飲む")).toBe("GODAN");
      expect(detectVerbType("書く")).toBe("GODAN");
      expect(detectVerbType("話す")).toBe("GODAN");
      expect(detectVerbType("買う")).toBe("GODAN");
      expect(detectVerbType("待つ")).toBe("GODAN");
      expect(detectVerbType("死ぬ")).toBe("GODAN");
      expect(detectVerbType("遊ぶ")).toBe("GODAN");
    });

    it("detects godan exceptions ending with る", () => {
      expect(detectVerbType("切る")).toBe("GODAN");
      expect(detectVerbType("走る")).toBe("GODAN");
      expect(detectVerbType("帰る")).toBe("GODAN");
      expect(detectVerbType("入る")).toBe("GODAN");
      expect(detectVerbType("知る")).toBe("GODAN");
    });
  });

  describe("Ichidan verbs (一段动词)", () => {
    it("detects verbs ending with いる", () => {
      expect(detectVerbType("見る")).toBe("ICHIDAN");
      expect(detectVerbType("起きる")).toBe("ICHIDAN");
    });

    it("detects verbs ending with える", () => {
      expect(detectVerbType("食べる")).toBe("ICHIDAN");
      expect(detectVerbType("教える")).toBe("ICHIDAN");
      expect(detectVerbType("寝る")).toBe("ICHIDAN");
    });
  });

  describe("Suru verbs (サ变动词)", () => {
    it("detects verbs ending with する", () => {
      expect(detectVerbType("勉強する")).toBe("SURU");
      expect(detectVerbType("仕事する")).toBe("SURU");
      expect(detectVerbType("運動する")).toBe("SURU");
    });
  });

  describe("Kuru verbs (カ变动词)", () => {
    it("detects 来る and compounds", () => {
      expect(detectVerbType("来る")).toBe("KURU");
      expect(detectVerbType("持って来る")).toBe("KURU");
    });
  });
});
