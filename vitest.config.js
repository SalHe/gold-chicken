import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    // 对局 soak（120 局 / 60 盘）在 CI 的共享 runner 上会明显慢于本机，
    // 默认 5s 会误报超时；这里统一放宽。
    testTimeout: 60000
  }
});
