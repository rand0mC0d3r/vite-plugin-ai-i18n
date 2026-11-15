import { describe, expect, it } from "vitest";
import { Semaphore } from "../src/concurrency.js";

describe("Semaphore", () => {
  it("never runs more tasks at once than its limit, across callers that share it", async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return running;
    };
    await Promise.all([1, 2, 3].map(() => Promise.all(Array.from({ length: 4 }, () => semaphore.run(task)))));
    expect(peak).toBe(2);
  });

  it("releases its slot when a task fails", async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(semaphore.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
