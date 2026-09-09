#!/usr/bin/env node
import { runFixture } from "./driver.mjs";
await runFixture("claude", { unauthenticated: true });
