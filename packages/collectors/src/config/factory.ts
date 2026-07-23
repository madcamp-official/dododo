import type { Collector } from "../../../shared/src/index.ts";
import { LmsCollector } from "../lms/index.ts";
import { SchoolEmailCollector } from "../school-email/index.ts";
import {
  createSchoolSiteHttpLoader,
  resolveBuiltInSchoolSiteRecipe,
  SchoolSiteCollector,
} from "../school-site/index.ts";
import { loadEmlDirectory, loadLmsHtmlFiles, type InputLoadError } from "./loaders.ts";
import type { SourceCollectorFactoryDependencies, SourceInputConfig } from "./types.ts";
import { validateSourceInputConfig } from "./validator.ts";

export function createSourceCollectors(
  config: SourceInputConfig,
  dependencies: SourceCollectorFactoryDependencies = {},
): Collector[] {
  validateSourceInputConfig(config);
  const collectors: Collector[] = [];

  for (const source of config.schoolSite ?? []) {
    if (source.enabled === false) continue;
    const recipe = source.recipe ?? resolveBuiltInSchoolSiteRecipe(source.url);
    collectors.push(new SchoolSiteCollector({
      sourceId: source.sourceId,
      baseUrl: source.url,
      selectors: source.selectors,
      recipe,
      loadHtml: createSchoolSiteHttpLoader({
        url: source.url,
        timeoutMs: source.timeoutMs,
        maxResponseBytes: source.maxResponseBytes,
        fetchImplementation: dependencies.fetchImplementation,
        encoding: recipe?.encoding,
      }),
      now: dependencies.now,
    }));
  }

  if (config.schoolEmail !== undefined && config.schoolEmail.enabled !== false) {
    const source = config.schoolEmail;
    let loadErrors: InputLoadError[] = [];
    const collector = new SchoolEmailCollector({
      sourceId: source.sourceId,
      allowedSenderDomains: source.allowedSenderDomains,
      maxMessageBytes: source.maxMessageBytes,
      loadMessages: async () => {
        const result = await loadEmlDirectory(source.inputDirectory);
        loadErrors = result.errors;
        return result.inputs;
      },
      now: dependencies.now,
    });
    collectors.push(withLoaderDiagnostics(collector, () => loadErrors));
  }

  if (config.lms !== undefined && config.lms.enabled !== false) {
    const source = config.lms;
    let loadErrors: InputLoadError[] = [];
    const collector = new LmsCollector({
      sourceId: source.sourceId,
      selectors: source.selectors,
      maxDocumentBytes: source.maxDocumentBytes,
      loadDocuments: async () => {
        const result = await loadLmsHtmlFiles(source.inputPaths);
        loadErrors = result.errors;
        return result.inputs.map((input) => ({ ...input, sourceUri: source.baseUrl }));
      },
      now: dependencies.now,
    });
    collectors.push(withLoaderDiagnostics(collector, () => loadErrors));
  }

  return collectors;
}

function withLoaderDiagnostics<T extends Collector & {
  listErrors(): Array<{ sourceUri?: string; message: string }>;
}>(collector: T, loaderErrors: () => InputLoadError[]): Collector & {
  listErrors(): Array<{ sourceUri?: string; message: string }>;
} {
  return {
    sourceId: collector.sourceId,
    sourceType: collector.sourceType,
    sync: () => collector.sync(),
    listErrors: () => [...loaderErrors(), ...collector.listErrors()],
  };
}
