import type { Operation } from "./api";
export async function ai<T>(operation: Operation): Promise<T> {
  const result = await window.fit.assistant(operation);
  if (!result.ok) throw Error(result.error);
  return result.value as T;
}
export type Reply = {
  status: string;
  reason?: string;
  detail?: string;
  answer?: {
    model?: {
      role: string;
      errorMessage?: string;
      content: { type: string; text?: string }[];
    }[];
  };
};
