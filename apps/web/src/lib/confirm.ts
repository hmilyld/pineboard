import { reactive, readonly } from "vue";
import { t } from "@/i18n";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

const state = reactive({
  open: false,
  title: "",
  message: "",
  confirmLabel: t("common.confirm"),
  cancelLabel: t("common.cancel"),
  danger: false,
});

let resolver: ((value: boolean) => void) | null = null;

export const confirmState = readonly(state);

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  resolver?.(false);
  Object.assign(state, {
    open: true,
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel ?? t("common.confirm"),
    cancelLabel: options.cancelLabel ?? t("common.cancel"),
    danger: options.danger ?? false,
  });
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
}

export function resolveConfirm(value: boolean): void {
  state.open = false;
  resolver?.(value);
  resolver = null;
}
