import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, RunTree } from 'langsmith';

const traceStore = new AsyncLocalStorage<RunTree>();
let cachedClient: Client | null = null;
let warnedMissingKey = false;

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function getLangSmithApiKey(): string {
  return env('LANGSMITH_API_KEY') || env('LANGCHAIN_API_KEY');
}

function getLangSmithEndpoint(): string {
  return env('LANGSMITH_ENDPOINT') || env('LANGCHAIN_ENDPOINT') || 'https://api.smith.langchain.com';
}

export function getLangSmithProject(): string {
  return env('LANGSMITH_PROJECT') || env('LANGCHAIN_PROJECT') || 'japanese-verb-master';
}

export function isLangSmithTracingEnabled(): boolean {
  const requested = isTruthy(env('LANGSMITH_TRACING')) ||
    isTruthy(env('LANGSMITH_TRACING_V2')) ||
    isTruthy(env('LANGCHAIN_TRACING')) ||
    isTruthy(env('LANGCHAIN_TRACING_V2'));

  if (!requested) return false;

  const apiKey = getLangSmithApiKey();
  if (!apiKey) {
    if (!warnedMissingKey) {
      console.warn('LangSmith tracing requested but LANGSMITH_API_KEY/LANGCHAIN_API_KEY is not set.');
      warnedMissingKey = true;
    }
    return false;
  }
  return true;
}

function getClient(): Client {
  if (!cachedClient) {
    cachedClient = new Client({
      apiUrl: getLangSmithEndpoint(),
      apiKey: getLangSmithApiKey()
    });
  }
  return cachedClient;
}

function currentRun(): RunTree | null {
  return traceStore.getStore() || null;
}

interface CreateRunConfig {
  name?: string;
  runType?: string;
  inputs?: any;
  metadata?: Record<string, any>;
  tags?: string[];
}

function createRun({ name, runType, inputs, metadata, tags }: CreateRunConfig): RunTree {
  const config: any = {
    name,
    run_type: runType || 'chain',
    inputs: inputs || {},
    metadata: {
      service: 'japanese-verb-master',
      ...metadata
    },
    tags: ['japanese-verb-master', ...(tags || [])],
    project_name: getLangSmithProject(),
    client: getClient()
  };

  const parent = currentRun();
  return parent ? parent.createChild(config) : new RunTree(config);
}

function serializeError(error: any): string | undefined {
  if (!error) return undefined;
  return error.stack || error.message || String(error);
}

function safeOutputs(value: any): Record<string, any> {
  if (value === undefined) return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return { output: value };
}

interface TraceOptions {
  processOutputs?: (result: any) => Promise<any> | any;
}

export async function traceLangSmithRun<T>(
  config: CreateRunConfig | null,
  fn: (run: RunTree) => Promise<T> | T,
  options: TraceOptions = {}
): Promise<T> {
  if (!isLangSmithTracingEnabled()) {
    return fn(null as any);
  }

  const run = createRun(config || {});
  await run.postRun();

  return traceStore.run(run, async (): Promise<T> => {
    try {
      const result = await fn(run);
      const outputs = options.processOutputs
        ? await options.processOutputs(result)
        : safeOutputs(result);
      await run.end(outputs);
      await run.patchRun();
      return result;
    } catch (error: any) {
      await run.end({}, serializeError(error));
      await run.patchRun();
      throw error;
    }
  });
}

export function addLangSmithEvent(name: string, kwargs: Record<string, any> = {}): void {
  const run = currentRun();
  if (!run || !isLangSmithTracingEnabled()) return;
  run.addEvent({
    name,
    time: new Date().toISOString(),
    kwargs
  });
}
