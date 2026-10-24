import { describe, expect, it } from "vitest";
import { ENGINE_ID_NAMESPACE, toDbId, uuidV5 } from "../../../../apps/server/src/persistence/ids";

describe("toDbId", () => {
  it("本来就是 uuid 的原样用（小写）", () => {
    expect(toDbId("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
  });

  it("引擎的确定性 id 换算成 uuid v5：同一个输入永远同一个结果，不同输入不同", () => {
    const a = toDbId("0f8fad5b-d9cb-469f-a165-70867728950e:t3453526449");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(toDbId("0f8fad5b-d9cb-469f-a165-70867728950e:t3453526449")).toBe(a);
    expect(toDbId("0f8fad5b-d9cb-469f-a165-70867728950e:t3453526450")).not.toBe(a);
  });

  it("uuid v5 算法对得上 RFC 9562 附录 A.4 的标准测试向量", () => {
    // DNS 命名空间 + "www.example.com" → 2ed6657d-e927-568b-95e1-2665a8aea6a2
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(ENGINE_ID_NAMESPACE).toHaveLength(36);
  });
});
