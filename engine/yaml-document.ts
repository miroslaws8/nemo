import fs from "node:fs";
import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Document,
} from "yaml";
import type {
  IYamlDocument,
  IYamlNodePath,
  IYamlPosition,
  IYamlSource,
} from "./types";

// The parser's "… at line 3, column 1:" and the excerpt after it: the position is given apart.
const LOCATION_SUFFIX = / at line \d+, column \d+:?[\s\S]*$/;

function documentOf(
  document: Document,
  lineCounter: LineCounter
): IYamlDocument {
  const positionAt = (offset: number): IYamlPosition => {
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };
  const nodeAt = (nodePath: IYamlNodePath): unknown =>
    nodePath.length === 0 ? document.contents : document.getIn(nodePath, true);

  // The deepest field or list item whose value spans `offset` (a key counts as its field's).
  const pathAround = (
    node: unknown,
    offset: number,
    nodePath: IYamlNodePath
  ): IYamlNodePath => {
    if (isMap(node)) {
      for (const entry of node.items) {
        const key = isScalar(entry.key) ? entry.key.value : null;
        const start = isNode(entry.key) ? entry.key.range?.[0] : undefined;
        const end = isNode(entry.value) ? entry.value.range?.[1] : undefined;
        if (
          (typeof key === "string" || typeof key === "number") &&
          start !== undefined &&
          end !== undefined &&
          offset >= start &&
          offset <= end
        ) {
          return pathAround(entry.value, offset, [...nodePath, key]);
        }
      }
    }
    if (isSeq(node)) {
      for (const [index, item] of node.items.entries()) {
        const range = isNode(item) ? item.range : undefined;
        if (range && offset >= range[0] && offset <= range[1]) {
          return pathAround(item, offset, [...nodePath, index]);
        }
      }
    }
    return nodePath;
  };

  return {
    data: document.toJS(),
    pathAt: (line: number, column: number): IYamlNodePath => {
      const lineStart = lineCounter.lineStarts[line - 1];
      return lineStart === undefined
        ? []
        : pathAround(document.contents, lineStart + column - 1, []);
    },
    lineOf: (nodePath: IYamlNodePath): number | null => {
      const node = nodeAt(nodePath);
      if (!isNode(node) || !node.range) {
        return null;
      }
      return lineCounter.linePos(node.range[0]).line;
    },
    positionOf: (
      nodePath: IYamlNodePath,
      key?: string
    ): IYamlPosition | null => {
      const node = nodeAt(nodePath);
      if (key === undefined) {
        return isNode(node) && node.range ? positionAt(node.range[0]) : null;
      }
      if (!isMap(node)) {
        return null;
      }
      const entry = node.items.find(
        (item) => isScalar(item.key) && item.key.value === key
      );
      return entry !== undefined && isNode(entry.key) && entry.key.range
        ? positionAt(entry.key.range[0])
        : null;
    },
  };
}

/** YAML with its positions, or why it is not YAML: the first syntax error and where it is. */
export function readYamlSource(text: string): IYamlSource {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter });
  const [firstError] = document.errors;
  if (firstError !== undefined) {
    const [start] = firstError.linePos ?? [];
    return {
      document: null,
      error: {
        message: firstError.message.replace(LOCATION_SUFFIX, ""),
        position:
          start === undefined ? null : { line: start.line, column: start.col },
      },
    };
  }
  return { document: documentOf(document, lineCounter), error: null };
}

/** Parses YAML and keeps line numbers, so errors and report steps can point at the source line. */
export function parseYamlText(text: string, label: string): IYamlDocument {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter });
  const [firstError] = document.errors;
  if (firstError !== undefined) {
    throw new Error(`${label}: ${firstError.message}`);
  }
  return documentOf(document, lineCounter);
}

export function readYamlDocument(
  filePath: string,
  label: string
): IYamlDocument {
  return parseYamlText(fs.readFileSync(filePath, "utf8"), label);
}
