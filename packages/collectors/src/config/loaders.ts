import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { LmsHtmlInput } from "../lms/types.ts";
import type { SchoolEmailInput } from "../school-email/types.ts";

export interface InputLoadError {
  sourceUri: string;
  message: string;
}

export interface InputLoadResult<T> {
  inputs: T[];
  errors: InputLoadError[];
}

export async function loadEmlDirectory(inputDirectory: string): Promise<InputLoadResult<SchoolEmailInput>> {
  const directory = resolve(inputDirectory);
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".eml"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return { inputs: [], errors: [{ sourceUri: directory, message: errorMessage(error) }] };
  }

  return loadIndependently(names.map((name) => resolve(directory, name)), async (path) => ({
    raw: await readFile(path),
    sourceUri: path,
  }));
}

export async function loadLmsHtmlFiles(inputPaths: readonly string[]): Promise<InputLoadResult<LmsHtmlInput>> {
  return loadIndependently(inputPaths.map((path) => resolve(path)), async (path) => ({
    html: await readFile(path, "utf8"),
    sourceUri: path,
  }));
}

async function loadIndependently<T>(
  paths: readonly string[],
  load: (path: string) => Promise<T>,
): Promise<InputLoadResult<T>> {
  const settled = await Promise.all(paths.map(async (path) => {
    try {
      return { input: await load(path) };
    } catch (error) {
      return { error: { sourceUri: path, message: errorMessage(error) } };
    }
  }));
  return {
    inputs: settled.flatMap((result) => result.input === undefined ? [] : [result.input]),
    errors: settled.flatMap((result) => result.error === undefined ? [] : [result.error]),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
