import { useEffect, useRef, type FormEvent, type ReactNode, type RefObject } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FieldErrors } from "../lib/settings";
import { ErrorBanner } from "./ui";

export interface ActionResult {
  ok: boolean;
  intent?: string;
  message?: string;
  error?: string;
  errors?: FieldErrors;
}

/**
 * A settings form wired to the admin's contextual save bar: editing any field
 * shows Save / Discard at the top of the admin; Save posts to the route action
 * with `intent=save`.
 */
export function SettingsForm({
  children,
  formRef,
  intent = "save",
  savedMessage = "Settings saved",
}: {
  children: (errors: FieldErrors) => ReactNode;
  formRef?: RefObject<HTMLFormElement | null>;
  intent?: string;
  savedMessage?: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const ownRef = useRef<HTMLFormElement>(null);
  const ref = formRef ?? ownRef;
  const result = fetcher.data?.intent === intent ? fetcher.data : undefined;

  useEffect(() => {
    if (fetcher.state !== "idle" || !result) return;
    if (result.ok) {
      shopify.toast.show(result.message ?? savedMessage);
      // The loader has re-run, so the fields' defaults are the saved values;
      // resetting marks the form clean and hides the save bar.
      ref.current?.reset();
    } else {
      shopify.toast.show("Couldn't save, check the highlighted fields", {
        isError: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, result]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("intent", intent);
    fetcher.submit(data, { method: "post" });
  };

  return (
    <form ref={ref} data-save-bar data-discard-confirmation onSubmit={onSubmit}>
      <s-stack gap="base">
        {result && !result.ok && result.error && <ErrorBanner error={result.error} />}
        {children(result?.errors ?? {})}
      </s-stack>
    </form>
  );
}

/** Runs one-off actions (sync, delete, approve…) and toasts the outcome. */
export function useActionFetcher() {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const { ok, message, error } = fetcher.data;
    if (ok && message) shopify.toast.show(message);
    if (!ok) shopify.toast.show(error ?? "Something went wrong", { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const run = (intent: string, fields: Record<string, string> = {}) =>
    fetcher.submit({ intent, ...fields }, { method: "post" });

  const busy = (intent: string) =>
    fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent;

  return { run, busy, fetcher };
}

export function errorResult(error: unknown, intent?: string): ActionResult {
  return {
    ok: false,
    intent,
    error: error instanceof Error ? error.message : String(error),
  };
}
