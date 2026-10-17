import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    // 对局 soak（120 局 / 60 盘）在 CI 的共享 runner 上会明显慢于本机，
    // 默认 5s 会误报超时；这里统一放宽。CI 实测约慢一倍，
    // 120 局 soak 本机 ~40s、CI ~80s，留足余量避免卡在临界线上。
    testTimeout: 180000
  }
});
