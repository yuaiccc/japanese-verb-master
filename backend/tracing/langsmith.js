import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, RunTree } from 'langsmith';

const traceStore = new AsyncLocalStorage();
let cachedClient = null;
let warnedMissingKey = false;

function env(name) {
  return String(process.env[name] || '').trim();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function getLangSmithApiKey() {
  return env('LANGSMITH_API_KEY') || env('LANGCHAIN_API_KEY');
}

function getLangSmithEndpoint() {
  return env('LANGSMITH_ENDPOINT') || env('LANGCHAIN_ENDPOINT') || 'https://api.smith.langchain.com';
}

export function getLangSmithProject() {
  return env('LANGSMITH_PROJECT') || env('LANGCHAIN_PROJECT') || 'japanese-verb-master';
}

export function isLangSmithTracingEnabled() {
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

function getClient() {
  if (!cachedClient) {
    cachedClient = new Client({
      apiUrl: getLangSmithEndpoint(),
      apiKey: getLangSmithApiKey()
    });
  }
  return cachedClient;
}

function currentRun() {
  return traceStore.getStore() || null;
}

function createRun({ name, runType, inputs, metadata, tags }) {
  const config = {
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

function serializeError(error) {
  if (!error) return undefined;
  return error.stack || error.message || String(error);
}

function safeOutputs(value) {
  if (value === undefined) return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return { output: value };
}

export async function traceLangSmithRun(config, fn, options = {}) {
  if (!isLangSmithTracingEnabled()) {
    return fn();
  }

  const run = createRun(config || {});
  await run.postRun();

  return traceStore.run(run, async () => {
    try {
      const result = await fn(run);
      const outputs = options.processOutputs
        ? await options.processOutputs(result)
        : safeOutputs(result);
      await run.end(outputs);
      await run.patchRun();
      return result;
    } catch (error) {
      await run.end({}, serializeError(error));
      await run.patchRun();
      throw error;
    }
  });
}

export function addLangSmithEvent(name, kwargs = {}) {
  const run = currentRun();
  if (!run || !isLangSmithTracingEnabled()) return;
  run.addEvent({
    name,
    time: new Date().toISOString(),
    kwargs
  });
}
