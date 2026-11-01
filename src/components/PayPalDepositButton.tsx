"use client";

import { useEffect, useRef, useState } from "react";

// PayPal JS SDK v5 with intent=authorize (PAYPAL_INTEGRATION.md §5.2). Our server creates the order
// for the rental's deposit; the browser never sends an amount.

interface PayPalButtonsInstance {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}
interface PayPalActions {
  restart(): Promise<void>;
}
interface PayPalNamespace {
  Buttons(options: {
    style?: Record<string, string>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }, actions: PayPalActions) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }): PayPalButtonsInstance;
}
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let sdkPromise: Promise<PayPalNamespace> | undefined;

function loadSdk(clientId: string): Promise<PayPalNamespace> {
  sdkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?${new URLSearchParams({
      "client-id": clientId,
      currency: "USD",
      intent: "authorize",
      components: "buttons",
    })}`;
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK loaded without window.paypal")));
    script.onerror = () => {
      sdkPromise = undefined;
      script.remove();
      reject(new Error("Could not load PayPal"));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

class ApiCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok || !json) {
    throw new ApiCallError(json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? `Request failed (HTTP ${res.status}).`);
  }
  return json;
}

interface Props {
  clientId: string;
  rentalId: string;
  onAuthorized: (confirmationPath: string) => void;
}

type Status = { kind: "loading" } | { kind: "ready" } | { kind: "working" } | { kind: "error"; message: string };

export function PayPalDepositButton({ clientId, rentalId, onAuthorized }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Keep the latest callback without re-rendering the PayPal buttons when the parent re-renders.
  const onAuthorizedRef = useRef(onAuthorized);
  useEffect(() => {
    onAuthorizedRef.current = onAuthorized;
  });

  useEffect(() => {
    let buttons: PayPalButtonsInstance | undefined;
    let cancelled = false;
    // The last error our own API returned; PayPal's onError only sees a generic failure.
    let apiError: string | undefined;

    loadSdk(clientId)
      .then((paypal) => {
        if (cancelled || !container.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", label: "paypal", shape: "rect" },
          createOrder: async () => {
            apiError = undefined;
            setStatus({ kind: "ready" });
            try {
              return (await postJson<{ orderId: string }>("/api/paypal/orders", { rentalId })).orderId;
            } catch (e) {
              apiError = e instanceof Error ? e.message : String(e);
              throw e;
            }
          },
          onApprove: async (data, actions) => {
            setStatus({ kind: "working" });
            try {
              const result = await postJson<{ confirmationPath: string }>(
                `/api/paypal/orders/${encodeURIComponent(data.orderID)}/authorize`,
                { rentalId },
              );
              onAuthorizedRef.current(result.confirmationPath);
            } catch (e) {
              if (e instanceof ApiCallError && e.code === "INSTRUMENT_DECLINED") {
                setStatus({ kind: "error", message: e.message });
                return actions.restart(); // documented recovery: let the buyer choose another funding source
              }
              apiError = e instanceof Error ? e.message : String(e);
              setStatus({ kind: "error", message: apiError });
            }
          },
          onCancel: () =>
            setStatus({ kind: "error", message: "You closed PayPal before approving. Nothing was authorized; you can try again." }),
          onError: () =>
            setStatus({ kind: "error", message: apiError ?? "PayPal reported an error. Nothing was authorized; please try again." }),
        });
        return buttons.render(container.current).then(() => {
          if (!cancelled) setStatus((s) => (s.kind === "loading" ? { kind: "ready" } : s));
        });
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error", message: "Could not load PayPal. Check your connection and retry." });
      });

    return () => {
      cancelled = true;
      void buttons?.close().catch(() => {});
    };
  }, [clientId, rentalId, attempt]);

  return (
    <div className="flex flex-col gap-3">
      {status.kind === "loading" && <p className="text-sm text-muted-foreground">Loading PayPal…</p>}
      <div ref={container} aria-busy={status.kind === "working"} className={status.kind === "working" ? "pointer-events-none opacity-50" : undefined} />
      <p role="status" aria-live="polite" className="text-sm">
        {status.kind === "working" && "Placing the deposit hold with PayPal…"}
      </p>
      {status.kind === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
          <p>{status.message}</p>
          <button type="button" className="underline underline-offset-4" onClick={() => setAttempt((n) => n + 1)}>
            Reload PayPal buttons
          </button>
        </div>
      )}
    </div>
  );
}
