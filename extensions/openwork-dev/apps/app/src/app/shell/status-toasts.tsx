import { For, createContext, createSignal, onCleanup, useContext, type ParentProps } from "solid-js";

import StatusToast from "../components/status-toast";

export type AppStatusToastTone = "success" | "info" | "warning" | "error";

export type AppStatusToastInput = {
  title: string;
  description?: string | null;
  tone?: AppStatusToastTone;
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  durationMs?: number;
};

export type AppStatusToast = AppStatusToastInput & {
  id: string;
};

export type StatusToastsStore = ReturnType<typeof createStatusToastsStore>;

const StatusToastsContext = createContext<StatusToastsStore>();

const defaultDurationForTone = (tone: AppStatusToastTone) => {
  if (tone === "warning" || tone === "error") return 4200;
  return 3200;
};

export function createStatusToastsStore() {
  const [toasts, setToasts] = createSignal<AppStatusToast[]>([]);
  const timers = new Map<string, number>();
  let counter = 0;

  const dismissToast = (id: string) => {
    const timer = timers.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (input: AppStatusToastInput) => {
    const id = `status-toast-${Date.now()}-${counter++}`;
    const tone = input.tone ?? "info";
    const toast: AppStatusToast = {
      ...input,
      tone,
      id,
    };

    setToasts((current) => [...current, toast].slice(-4));

    const duration = input.durationMs ?? defaultDurationForTone(tone);
    if (duration > 0) {
      const timer = window.setTimeout(() => {
        timers.delete(id);
        setToasts((current) => current.filter((item) => item.id !== id));
      }, duration);
      timers.set(id, timer);
    }

    return id;
  };

  const clearToasts = () => {
    for (const timer of timers.values()) {
      window.clearTimeout(timer);
    }
    timers.clear();
    setToasts([]);
  };

  onCleanup(() => {
    for (const timer of timers.values()) {
      window.clearTimeout(timer);
    }
    timers.clear();
  });

  return {
    toasts,
    showToast,
    dismissToast,
    clearToasts,
  };
}

export function StatusToastsProvider(props: ParentProps<{ store: StatusToastsStore }>) {
  return (
    <StatusToastsContext.Provider value={props.store}>
      {props.children}
    </StatusToastsContext.Provider>
  );
}

export function useStatusToasts() {
  const context = useContext(StatusToastsContext);
  if (!context) {
    throw new Error("useStatusToasts must be used within a StatusToastsProvider");
  }
  return context;
}

export function StatusToastsViewport() {
  const statusToasts = useStatusToasts();

  return (
    <For each={statusToasts.toasts()}>
      {(toast) => (
        <div class="pointer-events-auto">
          <StatusToast
            open
            tone={toast.tone}
            title={toast.title}
            description={toast.description ?? null}
            actionLabel={toast.actionLabel}
            onAction={toast.onAction}
            dismissLabel={toast.dismissLabel ?? "Dismiss"}
            onDismiss={() => statusToasts.dismissToast(toast.id)}
          />
        </div>
      )}
    </For>
  );
}
