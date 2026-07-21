import type { LLMErrorCategory } from "./errors.ts";
import type { JSONSchemaNode } from "./jsonSchema.ts";
import type { LLMModelKind } from "./provider.ts";

export type InferenceJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface RemoteInferenceRequest {
  modelKind: LLMModelKind;
  systemPrompt: string;
  userPrompt: string;
  schema: JSONSchemaNode;
  images?: string[];
  timeoutMs?: number;
  temperature?: number;
}

export interface CreateInferenceJobResponse {
  jobId: string;
  status: "queued";
  pollAfterMs: number;
}

export interface InferenceJobError {
  category: LLMErrorCategory;
  message: string;
  retryable: boolean;
}

export interface InferenceJobResponse {
  jobId: string;
  status: InferenceJobStatus;
  pollAfterMs?: number;
  result?: unknown;
  error?: InferenceJobError;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ActivateDeviceResponse {
  token: string;
  tokenType: "Bearer";
}

export interface GatewayErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
