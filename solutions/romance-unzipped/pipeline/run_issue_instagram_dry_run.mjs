#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "./_pipeline_node_entrypoint.mjs";

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
