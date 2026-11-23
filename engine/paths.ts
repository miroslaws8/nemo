import path from "node:path";

export const E2E_ROOT = path.resolve(__dirname, "..");

export const CONFIG_PATH = path.join(E2E_ROOT, "e2e.config.yaml");

export const TESTS_DIRECTORY = path.join(E2E_ROOT, "tests");
