import { createElement, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import type { PluginBridgeRegistry } from "./bridge-init";
import {
  _buildJsxRuntimeShimSourceForTests,
  _normalizeJsxRuntimePropsForTests,
} from "./slots";

describe("plugin jsx-runtime shim", () => {
  it("assigns stable keys to static child arrays so plugin jsxs output does not warn", () => {
    const props = _normalizeJsxRuntimePropsForTests(
      {
        children: [
          createElement("span", null, "first"),
          createElement("span", null, "second"),
        ],
      },
      undefined,
    );

    expect(Array.isArray(props.children)).toBe(true);
    const children = props.children as unknown[];
    expect(children).toHaveLength(2);
    expect(children.every((child) => isValidElement(child))).toBe(true);
    expect((children[0] as { key: string | null }).key).toBe("0");
    expect((children[1] as { key: string | null }).key).toBe("1");
  });

  it("preserves an explicit parent key while normalizing child arrays", () => {
    const props = _normalizeJsxRuntimePropsForTests(
      {
        children: [createElement("span", null, "only")],
      },
      "parent-key",
    );

    expect(props.key).toBe("parent-key");
    const children = props.children as unknown[];
    expect((children[0] as { key: string | null }).key).toBe("0");
  });

  it("evaluates the generated jsx-runtime shim without missing helper references", async () => {
    const previousBridge = globalThis.__paperclipPluginBridge__;
    try {
      globalThis.__paperclipPluginBridge__ = {
        react: await import("react"),
        reactDom: {},
        sdkUi: {},
      } as PluginBridgeRegistry;

      const source = _buildJsxRuntimeShimSourceForTests();
      const mod = await import(
        /* @vite-ignore */
        `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
      );

      const element = mod.jsxs("div", {
        children: [
          createElement("span", null, "first"),
          createElement("span", null, "second"),
        ],
      });

      expect(isValidElement(element)).toBe(true);
      const children = element.props.children as unknown[];
      expect((children[0] as { key: string | null }).key).toBe("0");
      expect((children[1] as { key: string | null }).key).toBe("1");
    } finally {
      globalThis.__paperclipPluginBridge__ = previousBridge;
    }
  });
});
