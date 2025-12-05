export type AuthPopupErrorCode =
  | "AUTH_POPUP_BLOCKED"
  | "AUTH_POPUP_CLOSED"
  | "AUTH_POPUP_TIMEOUT"
  | "AUTH_POPUP_MESSAGE_ERROR";

export interface AuthPopupError extends Error {
  code?: AuthPopupErrorCode | string;
}

type AuthPopupEventData = {
  type?: string;
  state?: string;
  [key: string]: unknown;
};

export interface OpenAuthPopupOptions<TData extends AuthPopupEventData = AuthPopupEventData> {
  /**
   * URL completa para abrir no popup (endpoint de OAuth).
   */
  url: string;
  /**
   * Nome lógico da janela (usado pelo browser para reusar popups).
   */
  windowName: string;
  /**
   * Features da janela (tamanho, scrollbars, etc.).
   */
  windowFeatures?: string;
  /**
   * Origin esperado para as mensagens recebidas via postMessage.
   * Default: window.location.origin.
   */
  expectedOrigin?: string;
  /**
   * Tipo de mensagem de sucesso enviada pelo callback (ex: "GOOGLE_SHEETS_AUTH_SUCCESS").
   */
  successType: string;
  /**
   * Tipo de mensagem de erro enviada pelo callback (ex: "GOOGLE_SHEETS_AUTH_ERROR").
   */
  errorType?: string;
  /**
   * Valor esperado de `state` para validar a mensagem (proteção CSRF).
   * Se informado, apenas mensagens com state igual serão consideradas.
   */
  expectedState?: string;
  /**
   * Timeout de segurança em ms. Default: 5 minutos.
   */
  timeoutMs?: number;
  /**
   * Permite customizar a interpretação da mensagem recebida.
   * Se fornecido, ignora o comportamento padrão baseado em successType/errorType.
   */
  checkMessage?: (
    event: MessageEvent<TData>
  ) =>
    | { kind: "ignore" }
    | { kind: "success"; payload: TData }
    | { kind: "error"; error: AuthPopupError };
}

/**
 * Abre um popup de OAuth e aguarda uma mensagem do callback via postMessage.
 * Resolve com os dados da mensagem de sucesso e rejeita em caso de erro,
 * fechamento manual do popup ou timeout.
 */
export async function openAuthPopup<TData extends AuthPopupEventData = AuthPopupEventData>(
  options: OpenAuthPopupOptions<TData>
): Promise<TData> {
  if (typeof window === "undefined") {
    const err: AuthPopupError = Object.assign(
      new Error("Popup de autenticação só pode ser usado no cliente."),
      { code: "AUTH_POPUP_MESSAGE_ERROR" as AuthPopupErrorCode }
    );
    throw err;
  }

  const {
    url,
    windowName,
    windowFeatures = "width=600,height=700,scrollbars=yes",
    expectedOrigin = window.location.origin,
    successType,
    errorType,
    expectedState,
    timeoutMs = 5 * 60 * 1000,
    checkMessage,
  } = options;

  const popup = window.open(url, windowName, windowFeatures);

  if (!popup) {
    const err: AuthPopupError = Object.assign(
      new Error("Não foi possível abrir a janela de autenticação. Verifique o bloqueador de pop-ups."),
      { code: "AUTH_POPUP_BLOCKED" as AuthPopupErrorCode }
    );
    throw err;
  }

  return new Promise<TData>((resolve, reject) => {
    let resolved = false;
    let timeoutId: number | undefined;
    let closeWatcherId: number | undefined;

    const cleanup = () => {
      window.removeEventListener("message", handleMessage as any);
      if (timeoutId) window.clearTimeout(timeoutId);
      if (closeWatcherId) window.clearInterval(closeWatcherId);
      if (!popup.closed) {
        popup.close();
      }
    };

    const safeReject = (error: AuthPopupError) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(error);
    };

    const handleMessage = (event: MessageEvent<TData>) => {
      if (event.origin !== expectedOrigin) return;
      if (!event.data || typeof event.data !== "object") return;

      const data = event.data;

      if (checkMessage) {
        const result = checkMessage(event);
        if (!result || result.kind === "ignore") return;
        if (result.kind === "error") {
          safeReject(result.error);
          return;
        }
        resolved = true;
        cleanup();
        resolve(result.payload);
        return;
      }

      const { type, state } = data as any;

      if (expectedState && state !== expectedState) return;

      if (type === successType) {
        resolved = true;
        cleanup();
        resolve(data);
        return;
      }

      if (errorType && type === errorType) {
        const anyData = data as any;
        const message =
          anyData.errorDescription ||
          anyData.error_description ||
          anyData.error ||
          "Falha na autenticação.";

        const err: AuthPopupError = Object.assign(new Error(message), {
          code: "AUTH_POPUP_MESSAGE_ERROR" as AuthPopupErrorCode,
        });
        safeReject(err);
      }
    };

    window.addEventListener("message", handleMessage as any);

    timeoutId = window.setTimeout(() => {
      const err: AuthPopupError = Object.assign(
        new Error("Tempo limite para autenticação atingido."),
        { code: "AUTH_POPUP_TIMEOUT" as AuthPopupErrorCode }
      );
      safeReject(err);
    }, timeoutMs);

    closeWatcherId = window.setInterval(() => {
      if (popup.closed) {
        const err: AuthPopupError = Object.assign(
          new Error("Autenticação cancelada pelo usuário (popup fechado)."),
          { code: "AUTH_POPUP_CLOSED" as AuthPopupErrorCode }
        );
        safeReject(err);
      }
    }, 500);
  });
}


