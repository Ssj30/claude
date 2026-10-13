import db from "../db.server";
import type { SettingsMap } from "./settings";

export interface N8nResult {
  ok: boolean;
  detail: string;
}

/**
 * POSTs JSON to the shop's n8n webhook and records the outcome, so the
 * Bookkeeping page can show what was sent and what failed.
 */
export async function postToN8n(
  shop: string,
  settings: SettingsMap["bookkeeping"],
  kind: string,
  label: string,
  payload: unknown,
): Promise<N8nResult> {
  if (!settings.n8nWebhookUrl) {
    return { ok: false, detail: "No n8n webhook URL set" };
  }
  let result: N8nResult;
  try {
    const response = await fetch(settings.n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Toolkit-Event": kind,
        "X-Toolkit-Shop": shop,
        ...(settings.n8nSecret ? { "X-Toolkit-Secret": settings.n8nSecret } : {}),
      },
      body: JSON.stringify({ event: kind, shop, sentAt: new Date().toISOString(), data: payload }),
      signal: AbortSignal.timeout(15_000),
    });
    result = response.ok
      ? { ok: true, detail: `n8n answered ${response.status}` }
      : {
          ok: false,
          detail: `n8n answered ${response.status} ${(await response.text()).slice(0, 200)}`,
        };
  } catch (error) {
    result = {
      ok: false,
      detail: error instanceof Error ? error.message : "Could not reach n8n",
    };
  }
  await db.syncLog.create({
    data: { shop, kind, label, ok: result.ok, detail: result.detail },
  });
  // Keep the log small.
  const old = await db.syncLog.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    skip: 200,
    select: { id: true },
  });
  if (old.length) {
    await db.syncLog.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
  return result;
}
