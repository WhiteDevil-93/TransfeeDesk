import { QueryClient, QueryFunction } from "@tanstack/react-query";

export const session: { token: string; onExpire?: () => void } = { token: "" };
const authH = (token: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
export const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response, requestToken: string) {
  if (res.status === 401 && requestToken && requestToken === session.token) { session.token = ""; session.onExpire?.(); }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  const token = session.token;
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...authH(token) },
    body: data ? JSON.stringify(data) : undefined,
    signal: options?.signal,
  });

  await throwIfResNotOk(res, token);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const token = session.token;
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers: authH(token), signal });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, token);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
